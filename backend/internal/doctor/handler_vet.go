package doctor

import (
	"net/http"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"

	"github.com/gin-gonic/gin"
)

// handler_vet.go — Wave 3b (VETERINARY / PET-side) Gin handlers.
// One handler per service_vet.go method. Reuses the shared helpers from handler.go /
// handler_account.go (h.userID, h.fail, h.rawBody) and mirrors the established
// handler_clinical.go style: reads return 200 with the projection; creates return 201;
// state transitions / sends require an Idempotency-Key (the service enforces it) and
// return 200/201. Everything is scoped to the authed vet (user_id).

func (h *Handler) GetVetDashboard(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetVetDashboard(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) ToggleVetMode(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.ToggleVetMode(c.Request.Context(), uid, ginutil.IdempotencyKey(c), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) ListVetAppointments(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListVetAppointments(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) ListPetOwnerRequests(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListPetOwnerRequests(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) RespondToOwnerRequest(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.RespondToOwnerRequest(c.Request.Context(), uid, c.Param("requestId"), ginutil.IdempotencyKey(c), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) GetPetChatThread(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetPetChatThread(c.Request.Context(), uid, c.Param("petId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) GetPetCallSession(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetPetCallSession(c.Request.Context(), uid, c.Param("petId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) GetPetSoapNote(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetPetSoapNote(c.Request.Context(), uid, c.Param("petId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) SaveVetSoapNote(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.SaveVetSoapNote(c.Request.Context(), uid, ginutil.IdempotencyKey(c), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

func (h *Handler) ListPetEmergencyWarnings(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListPetEmergencyWarnings(c.Request.Context(), uid, c.Param("petId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) ListVetSpecialists(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListVetSpecialists(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) ListPetReferrals(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListPetReferrals(c.Request.Context(), uid, c.Param("petId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) CreateVetReferral(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.CreateVetReferral(c.Request.Context(), uid, ginutil.IdempotencyKey(c), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

func (h *Handler) GetVetConsultSummary(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetVetConsultSummary(c.Request.Context(), uid, c.Param("consultId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) ListVetConsultHistory(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListVetConsultHistory(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) GetPet(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetPet(c.Request.Context(), uid, c.Param("petId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) ListPetVaccinations(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListPetVaccinations(c.Request.Context(), uid, c.Param("petId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) GetPetHealthRecord(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetPetHealthRecord(c.Request.Context(), uid, c.Param("petId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) GetPetGrowth(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetPetGrowth(c.Request.Context(), uid, c.Param("petId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) RecordPetGrowth(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.RecordPetGrowth(c.Request.Context(), uid, c.Param("petId"), ginutil.IdempotencyKey(c), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

func (h *Handler) GetPetPrescriptionForPet(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetPetPrescriptionForPet(c.Request.Context(), uid, c.Param("petId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) ListPetPrescriptions(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListPetPrescriptions(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) GetIssuedPetPrescription(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetIssuedPetPrescription(c.Request.Context(), uid, c.Param("prescriptionId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) CreatePetPrescription(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.CreatePetPrescription(c.Request.Context(), uid, ginutil.IdempotencyKey(c), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

func (h *Handler) IssuePetPrescription(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.IssuePetPrescription(c.Request.Context(), uid, c.Param("prescriptionId"), ginutil.IdempotencyKey(c), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) SendPetPrescription(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.SendPetPrescription(c.Request.Context(), uid, c.Param("prescriptionId"), ginutil.IdempotencyKey(c), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) ListPetRefills(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListPetRefills(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) RequestPetRefill(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.RequestPetRefill(c.Request.Context(), uid, ginutil.IdempotencyKey(c), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

func (h *Handler) ReviewPetRefill(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.ReviewPetRefill(c.Request.Context(), uid, c.Param("refillId"), ginutil.IdempotencyKey(c), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) ListPetPharmacies(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListPetPharmacies(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) ListPetLabOrders(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListPetLabOrders(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) CreatePetLabOrder(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.CreatePetLabOrder(c.Request.Context(), uid, ginutil.IdempotencyKey(c), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

func (h *Handler) GetPetLabResultForOrder(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetPetLabResultForOrder(c.Request.Context(), uid, c.Param("orderId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) ListPetLabCatalogue(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListPetLabCatalogue(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) ListPetLabResultInbox(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListPetLabResultInbox(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) ReviewPetLabResult(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ReviewPetLabResult(c.Request.Context(), uid, c.Param("resultId"), ginutil.IdempotencyKey(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) AddPetLabInterpretation(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.AddPetLabInterpretation(c.Request.Context(), uid, c.Param("resultId"), ginutil.IdempotencyKey(c), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) ListPetVaccinationRecommendations(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListPetVaccinationRecommendations(c.Request.Context(), uid, c.Param("petId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) ListPetVaccinationReminders(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListPetVaccinationReminders(c.Request.Context(), uid, c.Param("petId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) SetPetVaccinationReminder(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.SetPetVaccinationReminder(c.Request.Context(), uid, ginutil.IdempotencyKey(c), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

func (h *Handler) ListPetChronicMonitoring(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListPetChronicMonitoring(c.Request.Context(), uid, c.Param("petId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) SavePetChronicMonitoring(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.SavePetChronicMonitoring(c.Request.Context(), uid, c.Param("petId"), ginutil.IdempotencyKey(c), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

func (h *Handler) ListPetProducts(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListPetProducts(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) GetPetProduct(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetPetProduct(c.Request.Context(), uid, c.Param("productId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) ListPetRecommendations(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListPetRecommendations(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) ListPetRecommendationsForPet(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListPetRecommendationsForPet(c.Request.Context(), uid, c.Param("petId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) RecommendPetProducts(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.RecommendPetProducts(c.Request.Context(), uid, ginutil.IdempotencyKey(c), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

func (h *Handler) SharePetRecommendation(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.SharePetRecommendation(c.Request.Context(), uid, c.Param("recommendationId"), ginutil.IdempotencyKey(c), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) ListPetFulfilments(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListPetFulfilments(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) GetPetFulfilment(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetPetFulfilment(c.Request.Context(), uid, c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// Gin handlers for the VET licence / verification /
// profile-publish / profile-draft "tail" endpoints. Additive (separate file to avoid
// colliding with concurrent edits to handler_vet.go). Routes are wired by the parent in
// finance_routes.go under /api/v1/doctor:
//	POST /vet/licence/renew   -> RenewVetLicence
//	POST /vet/verification    -> SubmitVetVerification
//	POST /vet/profile/publish -> PublishVetProfile
//	PUT  /vet/profile/draft   -> SaveVetProfileDraft
// Each handler reuses the shared helpers from handler.go (h.userID, h.fail)
// and handler_account.go (h.rawBody), scopes to the authenticated vet, and mirrors the
// human-side account handlers. Mutations forward the Idempotency-Key; the service rejects
// a missing key with ErrIdempotencyRequired (→ 400). Creates return 201, the draft
// upsert returns 200.

// RenewVetLicence records / renews the vet licence (re-enters verification). 201.
func (h *Handler) RenewVetLicence(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	var req SubmitVerificationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	res, err := h.svc.RenewVetLicence(c.Request.Context(), uid, ginutil.IdempotencyKey(c), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

// SubmitVetVerification submits the vet's verification. 201.
func (h *Handler) SubmitVetVerification(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	var req SubmitVerificationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	res, err := h.svc.SubmitVetVerification(c.Request.Context(), uid, ginutil.IdempotencyKey(c), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

// PublishVetProfile marks the vet profile live (fail-closed on verification). 201
// would imply a new resource; publishing transitions the existing row, so 200.
func (h *Handler) PublishVetProfile(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.PublishVetProfile(c.Request.Context(), uid, ginutil.IdempotencyKey(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// SaveVetProfileDraft upserts (patch-merges) the vet profile draft. 200.
func (h *Handler) SaveVetProfileDraft(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	patch, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.SaveVetProfileDraft(c.Request.Context(), uid, ginutil.IdempotencyKey(c), patch)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}
