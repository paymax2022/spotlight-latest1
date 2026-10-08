package app

import (
	"testing"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/property"
	propertyroles "spotlight/backend/internal/property/roles"
)

func TestPropertyRolesRoutesNoConflict(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	finance := r.Group("/api/finance")
	ph := property.NewHandler(property.NewService(nil))
	pg := finance.Group("/property")
	pg.GET("/context", ph.GetContext)
	pg.POST("/context/switch", ph.SwitchContext)
	pg.GET("/rent-passport/me", ph.GetMyRentPassport)
	pg.GET("/rent-passport/lookup/:userId", ph.LookupRentPassport)
	h := propertyroles.NewHandler(nil, nil)
	propertyroles.RegisterMember(finance.Group("/property/roles"), h)
	propertyroles.RegisterAdmin(r.Group("/api/property/admin/roles"), h, func(c *gin.Context) {})
}
