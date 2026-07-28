package transport

import (
	"context"
	"net/http"
	"time"

	"github.com/google/uuid"
)

// SubmitOnboarding upserts the driver record with contact + service data and
// moves verification_status draft → submitted. A driver row is auto-created if
// the user has not registered one yet (their auth identity is reused).
func (s *Service) SubmitOnboarding(ctx context.Context, userID string, req OnboardingSubmitRequest) (*Driver, error) {
	cats := req.ServiceCategories
	if len(cats) == 0 {
		cats = []string{"ride_hailing"}
	}
	var driverID string
	err := s.db.QueryRow(ctx, `SELECT id FROM drivers WHERE user_id=$1`, userID).Scan(&driverID)
	if err != nil {
		// Create a minimal driver row from the submission.
		driverID = uuid.New().String()
		if _, err := s.db.Exec(ctx, `
			INSERT INTO drivers (id, user_id, name, vehicle_reg, vehicle_type, status, phone, email, photo_url,
			                     verification_status, service_categories)
			VALUES ($1,$2,$3,'','car','offline',$4,$5,$6,'submitted',$7)`,
			driverID, userID, req.Email, req.Phone, req.Email, req.PhotoURL, cats); err != nil {
			return nil, err
		}
	} else {
		if _, err := s.db.Exec(ctx, `
			UPDATE drivers SET phone=$1, email=$2, photo_url=$3, service_categories=$4,
			       verification_status='submitted', updated_at=NOW()
			WHERE id=$5 AND verification_status IN ('draft','rejected')`,
			req.Phone, req.Email, req.PhotoURL, cats, driverID); err != nil {
			return nil, err
		}
	}
	return s.DriverMe(ctx, userID)
}

// AddDocument records an uploaded onboarding document.
func (s *Service) AddDocument(ctx context.Context, userID string, req DocumentRequest) (*DriverDocument, error) {
	driverID, err := s.resolveDriverID(ctx, userID)
	if err != nil {
		return nil, err
	}
	var expiry *time.Time
	if req.ExpiryDate != nil && *req.ExpiryDate != "" {
		if t, perr := time.Parse("2006-01-02", *req.ExpiryDate); perr == nil {
			expiry = &t
		}
	}
	doc := &DriverDocument{ID: uuid.New().String(), DriverID: driverID, DocType: req.DocType, FileURL: req.FileURL, Status: "submitted", ExpiryDate: expiry}
	if err := s.db.QueryRow(ctx,
		`INSERT INTO driver_documents (id, driver_id, doc_type, file_url, status, expiry_date)
		 VALUES ($1,$2,$3,$4,'submitted',$5) RETURNING created_at`,
		doc.ID, driverID, req.DocType, req.FileURL, expiry).Scan(&doc.CreatedAt); err != nil {
		return nil, err
	}
	return doc, nil
}

// AddVehicle registers a vehicle for the driver.
func (s *Service) AddVehicle(ctx context.Context, userID string, req VehicleRequest) (*Vehicle, error) {
	driverID, err := s.resolveDriverID(ctx, userID)
	if err != nil {
		return nil, err
	}
	category := req.Category
	if category == "" {
		category = "economy"
	}
	capacity := req.Capacity
	if capacity <= 0 {
		capacity = 4
	}
	v := &Vehicle{ID: uuid.New().String(), DriverID: driverID, PlateNumber: req.PlateNumber, Category: category, Capacity: capacity}
	var year *int
	if req.Year > 0 {
		year = &req.Year
	}
	if err := s.db.QueryRow(ctx, `
		INSERT INTO vehicles (id, driver_id, plate_number, make, model, year, color, category, capacity)
		VALUES ($1,$2,$3,NULLIF($4,''),NULLIF($5,''),$6,NULLIF($7,''),$8,$9)
		RETURNING created_at, updated_at`,
		v.ID, driverID, req.PlateNumber, req.Make, req.Model, year, req.Color, category, capacity).
		Scan(&v.CreatedAt, &v.UpdatedAt); err != nil {
		return nil, err
	}
	return v, nil
}

// DriverMe returns the driver profile + verification + documents + vehicle.
func (s *Service) DriverMe(ctx context.Context, userID string) (*Driver, error) {
	var d Driver
	var vstatus string
	if err := s.db.QueryRow(ctx, `
		SELECT id, user_id, name, vehicle_reg, vehicle_type, status, rating, verification_status, created_at
		FROM drivers WHERE user_id=$1`, userID).Scan(
		&d.ID, &d.UserID, &d.Name, &d.VehicleReg, &d.VehicleType, &d.Status, &d.Rating, &vstatus, &d.CreatedAt,
	); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "driver not found")
	}
	return &d, nil
}

// DriverMeFull returns the driver plus verification status, docs, and vehicles.
func (s *Service) DriverMeFull(ctx context.Context, userID string) (map[string]any, error) {
	var id, name, vreg, vtype, status, vstatus string
	var rating float64
	var phone, email, photo *string
	if err := s.db.QueryRow(ctx, `
		SELECT id, name, vehicle_reg, vehicle_type, status, rating, verification_status, phone, email, photo_url
		FROM drivers WHERE user_id=$1`, userID).Scan(
		&id, &name, &vreg, &vtype, &status, &rating, &vstatus, &phone, &email, &photo,
	); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "driver not found")
	}
	docs, _ := s.listDocuments(ctx, id)
	vehicles, _ := s.listVehicles(ctx, id)
	return map[string]any{
		"id": id, "name": name, "vehicle_reg": vreg, "vehicle_type": vtype,
		"status": status, "rating": rating, "verification_status": vstatus,
		"phone": phone, "email": email, "photo_url": photo,
		"documents": docs, "vehicles": vehicles,
	}, nil
}

func (s *Service) listDocuments(ctx context.Context, driverID string) ([]DriverDocument, error) {
	rows, err := s.db.Query(ctx, `SELECT id, driver_id, doc_type, file_url, status, expiry_date, created_at FROM driver_documents WHERE driver_id=$1 ORDER BY created_at`, driverID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DriverDocument
	for rows.Next() {
		var d DriverDocument
		if err := rows.Scan(&d.ID, &d.DriverID, &d.DocType, &d.FileURL, &d.Status, &d.ExpiryDate, &d.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, nil
}

func (s *Service) listVehicles(ctx context.Context, driverID string) ([]Vehicle, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, driver_id, plate_number, make, model, year, color, category, capacity,
		       inspection_status, insurance_status, status, created_at, updated_at
		FROM vehicles WHERE driver_id=$1 ORDER BY created_at`, driverID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Vehicle
	for rows.Next() {
		var v Vehicle
		if err := rows.Scan(&v.ID, &v.DriverID, &v.PlateNumber, &v.Make, &v.Model, &v.Year, &v.Color,
			&v.Category, &v.Capacity, &v.InspectionStatus, &v.InsuranceStatus, &v.Status, &v.CreatedAt, &v.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, nil
}

// SetDriverOnline updates availability + current location. Only approved drivers
// may go online (verification gating).
func (s *Service) SetDriverOnline(ctx context.Context, userID string, req DriverStatusRequest) error {
	var vstatus string
	if err := s.db.QueryRow(ctx, `SELECT verification_status FROM drivers WHERE user_id=$1`, userID).Scan(&vstatus); err != nil {
		return codedErr(http.StatusNotFound, CodeNotFound, "driver not found")
	}
	if req.Status == "online" && vstatus != "approved" {
		return codedErr(http.StatusForbidden, CodeNotApproved, "only approved drivers may go online")
	}
	if req.Status == "online" {
		_, err := s.db.Exec(ctx, `
			UPDATE drivers SET status='online', current_lat=$1, current_lng=$2, online_since=NOW(), updated_at=NOW()
			WHERE user_id=$3`, req.Lat, req.Lng, userID)
		return err
	}
	_, err := s.db.Exec(ctx, `UPDATE drivers SET status='offline', online_since=NULL, updated_at=NOW() WHERE user_id=$1`, userID)
	return err
}

// ─── Rider mobility profile ──────────────────────────────────────────────────

func (s *Service) GetProfile(ctx context.Context, userID string) (*MobilityProfile, error) {
	p, err := s.queryProfile(ctx, userID)
	if err == nil {
		return p, nil
	}
	// Lazily create a default profile.
	if _, err := s.db.Exec(ctx, `INSERT INTO mobility_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, userID); err != nil {
		return nil, err
	}
	return s.queryProfile(ctx, userID)
}

func (s *Service) queryProfile(ctx context.Context, userID string) (*MobilityProfile, error) {
	var p MobilityProfile
	if err := s.db.QueryRow(ctx, `
		SELECT id, user_id, trust_level, default_payment, home_address, work_address, rating, completed_trips, status, created_at, updated_at
		FROM mobility_profiles WHERE user_id=$1`, userID).Scan(
		&p.ID, &p.UserID, &p.TrustLevel, &p.DefaultPayment, &p.HomeAddress, &p.WorkAddress, &p.Rating, &p.CompletedTrips, &p.Status, &p.CreatedAt, &p.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return &p, nil
}

func (s *Service) UpsertProfile(ctx context.Context, userID string, req UpsertProfileRequest) (*MobilityProfile, error) {
	if _, err := s.GetProfile(ctx, userID); err != nil {
		return nil, err
	}
	if _, err := s.db.Exec(ctx, `
		UPDATE mobility_profiles
		SET default_payment=COALESCE(NULLIF($2,''), default_payment),
		    home_address=COALESCE($3, home_address),
		    work_address=COALESCE($4, work_address),
		    updated_at=NOW()
		WHERE user_id=$1`,
		userID, req.DefaultPayment, req.HomeAddress, req.WorkAddress); err != nil {
		return nil, err
	}
	return s.queryProfile(ctx, userID)
}
