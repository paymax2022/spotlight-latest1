package domain

type AdminUser struct {
	ID               string `json:"id"`
	FirstName        string `json:"firstName"`
	LastName         string `json:"lastName"`
	Email            string `json:"email"`
	Phone            string `json:"phone"`
	UserType         string `json:"userType"`
	Status           string `json:"status"`
	ProfileCompleted bool   `json:"profileCompleted"`
	State            string `json:"state"`
	Country          string `json:"country"`
	ProgramID        string `json:"programId"`
	ContestID        string `json:"contestId"`
	SchoolID         string `json:"schoolId"`
	CreatedAt        string `json:"createdAt"`
}

type AdminUserFilter struct {
	Role     string
	UserType string
	Status   string
	State    string
	Program  string
	Search   string
	Limit    int
}
