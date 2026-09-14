# Facilities Management & RBAC System

## Overview

The Facilities Management system provides comprehensive estate facility management with granular role-based access control (RBAC). It allows estate administrators to create, manage, and control access to facilities (pools, gyms, meeting halls, etc.) while displaying user privileges across modules.

## Features

### 1. Facilities Management (`/admin/estate/facilities`)

**Admin Dashboard**
- Create new facilities with name, type, capacity, and booking fees
- View all facilities in a sortable, searchable table
- Edit facility details (name, capacity, fees)
- View booking history and status for each facility

**Facility Details Page** (`/admin/estate/facilities/[id]`)
- Edit facility information
- View all bookings with resident names, dates, and payment status
- Track booking confirmations and cancellations
- Monitor facility revenue

**Data Structure**
- Table: `estate_facilities`
  - `id`: UUID (primary key)
  - `estate_id`: Foreign key to estates
  - `name`: Facility name (e.g., "Olympic Pool")
  - `kind`: Facility type (pool, gym, tennis, hall, playground, garden, parking, other)
  - `capacity`: Optional capacity limit (number of people)
  - `fee_kobo`: Booking fee in minor units (kobo)
  - `created_at`: Timestamp

- Table: `facility_bookings`
  - `id`: UUID (primary key)
  - `facility_id`: Foreign key to estate_facilities
  - `resident_id`: Foreign key to auth.users
  - `starts_at`: Booking start time
  - `ends_at`: Booking end time
  - `status`: pending, confirmed, cancelled, refunded
  - `amount_kobo`: Amount paid in minor units
  - `created_at`: Timestamp

### 2. User Privileges Display (`/admin/modules/privileges`)

**Features**
- View all users with their roles and permissions
- Display permissions organized by module (Estate Admin, Platform, Finance, Marketplace)
- Show which modules each user has access to
- List specific permissions within each module
- Easy-to-read badge-based UI showing active/inactive modules

**Modules Covered**
- **Estate Admin**: Security, Dues, Operations, Content, Elections, Facilities
- **Platform**: User Management, Role Management, Permissions, Audit
- **Finance**: Wallets, Ledger, Settlement, Reporting
- **Marketplace**: Vendors, Orders, Disputes, Reporting

### 3. Facilities RBAC Management (`/admin/modules/facilities-rbac`)

**Features**
- Configure facility permissions for each role
- Six granular facility permissions:
  - `facilitiesCreate`: Create new facilities
  - `facilitiesEdit`: Edit facility details
  - `facilitiesDelete`: Delete facilities
  - `facilitiesBookingsView`: View facility bookings
  - `facilitiesBookingsApprove`: Approve pending bookings
  - `facilitiesBookingsCancel`: Cancel bookings and refund

**Permission Model**
Permissions follow the pattern: `estate.admin.facilities.{action}`
- `estate.admin.facilities.create`
- `estate.admin.facilities.edit`
- `estate.admin.facilities.delete`
- `estate.admin.facilities.bookings.view`
- `estate.admin.facilities.bookings.approve`
- `estate.admin.facilities.bookings.cancel`

## API Endpoints

### Facilities Management

**List All Facilities**
```
GET /api/admin/facilities
```
Returns array of all facilities across all estates.

**Create Facility**
```
POST /api/admin/facilities
{
  "estateId": "uuid",
  "name": "Olympic Pool",
  "kind": "pool",
  "capacity": 50,
  "feeKobo": 500000  // ₦5,000
}
```

**Get Facility Details**
```
GET /api/admin/facilities/[id]
```
Returns single facility with all details.

**Update Facility**
```
PATCH /api/admin/facilities/[id]
{
  "name": "Olympic Pool",
  "capacity": 50,
  "feeKobo": 500000
}
```

**Get Facility Bookings**
```
GET /api/admin/facilities/[id]/bookings
```
Returns array of bookings for the facility.

### User Privileges

**Get All User Privileges**
```
GET /api/admin/privileges
```
Returns array of users with their module permissions organized by module.

### Facilities RBAC

**Get Facilities RBAC Configuration**
```
GET /api/admin/modules/facilities-rbac
```
Returns array of roles with their facilities permissions.

**Update Role Facilities Permissions**
```
PATCH /api/admin/modules/facilities-rbac/[roleId]
{
  "facilitiesCreate": true,
  "facilitiesEdit": true,
  "facilitiesDelete": false,
  "facilitiesBookingsView": true,
  "facilitiesBookingsApprove": true,
  "facilitiesBookingsCancel": false
}
```

## Usage Workflow

### As an Estate Administrator

1. **Create a Facility**
   - Navigate to `/admin/estate/facilities`
   - Click "New Facility"
   - Fill in facility details (name, type, optional capacity, booking fee)
   - Submit to create

2. **Manage a Facility**
   - Click "Manage" on any facility in the list
   - View and edit facility details
   - Monitor all bookings for the facility
   - Track booking status and revenue

3. **View Resident Bookings**
   - Check facility booking list
   - Verify booking details (dates, resident, amount)
   - Monitor booking status (pending, confirmed, cancelled)

### As a Platform Administrator

1. **View User Privileges**
   - Navigate to `/admin/modules/privileges`
   - Select a user from the list
   - View all module access and specific permissions
   - Understand what each user can do in each module

2. **Manage Facilities RBAC**
   - Navigate to `/admin/modules/facilities-rbac`
   - For each role, review and configure facility permissions
   - Click "Edit" to enable/disable specific permissions
   - Save changes

3. **Role-Based Access Control**
   - Estate Managers: Usually have all facilities permissions
   - Security Team: May have facilities.bookings.view only
   - Finance Team: May have facilities.bookings.view for revenue tracking
   - Guest Users: No facilities permissions

## Database Schema

### New Tables
- `estate_facilities`: Facility master data
- `facility_bookings`: Booking records

### New Permissions (via migration)
- 6 facilities-related permissions for granular RBAC

### Relationships
```
estates
  ├── estate_facilities
  │   └── facility_bookings → auth.users (resident)
  ├── estate_properties
  └── estate_residents
```

## Frontend Navigation

**Admin Dashboard Structure**
```
/admin/estate/
├── /admin/estate/facilities          # Facilities list & create
├── /admin/estate/facilities/[id]     # Facility detail & edit
├── /admin/modules/privileges         # User privileges display
└── /admin/modules/facilities-rbac    # Facilities RBAC config
```

**Tab Navigation**
- "Facilities" tab added to EstateTabs in `/admin/estate/_ui.tsx`
- Placed between "Gates & security" and "Vendors" tabs

## Implementation Notes

### Money Handling
All monetary amounts (fees, booking costs) use **minor units (kobo)**:
- ₦1 = 100 kobo
- Store as integers, never floats
- Example: ₦5,000 = 500000 kobo

### Permissions
- Base module: `estate.admin`
- Facilities sub-module: `estate.admin.facilities`
- Granular actions: `estate.admin.facilities.{create|edit|delete|bookings.view|bookings.approve|bookings.cancel}`

### User Access Control
1. **Frontend**: Client-side permission checking via `hasAnyPermission()` 
2. **Backend**: Every API endpoint requires `requireRequestUser()` and validates against user's roles/permissions
3. **Database**: RLS policies ensure users can only access their estate's facilities

### UI Components
- Reuses Vuexy component library from admin dashboard
- Consistent styling with other estate admin pages
- Responsive grid layouts for tables and forms
- Status badges for facility types and booking states

## Related Files

**Frontend Admin**
- `/app/admin/estate/facilities/page.tsx` - Facilities list & create
- `/app/admin/estate/facilities/[id]/page.tsx` - Facility detail page
- `/app/admin/modules/privileges/page.tsx` - User privileges display
- `/app/admin/modules/facilities-rbac/page.tsx` - Facilities RBAC config
- `/app/admin/estate/_ui.tsx` - Updated with Facilities tab

**Backend API**
- `/app/api/admin/facilities/route.ts` - List & create facilities
- `/app/api/admin/facilities/[id]/route.ts` - Get & update facility
- `/app/api/admin/facilities/[id]/bookings/route.ts` - Get facility bookings
- `/app/api/admin/privileges/route.ts` - Get user privileges
- `/app/api/admin/modules/facilities-rbac/route.ts` - Get RBAC config
- `/app/api/admin/modules/facilities-rbac/[roleId]/route.ts` - Update RBAC

**Database**
- `/supabase/migrations/20260909000000_estate_facilities_rbac.sql` - Add permissions

## Future Enhancements

1. **Booking Approval Workflow**
   - Pending → Confirmed → Completed flow
   - Admin approval for bookings
   - Automatic refund on cancellation

2. **Facility Analytics**
   - Booking occupancy rates
   - Revenue tracking per facility
   - Peak usage times

3. **Resident Self-Service**
   - Residents can view available facilities at their estate
   - Make and manage their own bookings
   - View booking history

4. **Facility Maintenance**
   - Schedule maintenance windows
   - Block facility during maintenance
   - Track maintenance history

5. **Multi-Estate Facilities**
   - Shared facilities between estates
   - Cross-estate bookings

## Security Considerations

✅ **Implemented**
- User authentication required for all endpoints
- RBAC permission checks on every action
- Money amounts in minor units (no floating point)
- Estate-scoped data access
- SQL injection protection via parameterized queries

⚠️ **To Review**
- RLS policies on facility tables
- Rate limiting on booking endpoints
- Audit logging for facility changes
- Refund reconciliation safety

## Testing Checklist

- [ ] Create facility with all field types
- [ ] Edit facility details
- [ ] View facility bookings list
- [ ] User privileges page loads all users
- [ ] User privileges show correct module access
- [ ] Facilities RBAC page shows all roles
- [ ] Can toggle facilities permissions per role
- [ ] Changes persist after save
- [ ] Permission checks prevent unauthorized access
- [ ] Estate scope isolation verified
