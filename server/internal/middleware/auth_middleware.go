package middleware

import (
	"strings"

	"github.com/gofiber/fiber/v2"

	"sxfgssever/server/internal/model"
	"sxfgssever/server/internal/response"
	"sxfgssever/server/internal/service"
)

const (
	LocalAuthUser   = "auth_user"
	LocalAuthUserID = "auth_user_id"
	LocalAuthRole   = "auth_role"
)

type AuthMiddleware struct {
	authService service.AuthService
}

func NewAuthMiddleware(authService service.AuthService) *AuthMiddleware {
	return &AuthMiddleware{
		authService: authService,
	}
}

func (middleware *AuthMiddleware) Require(c *fiber.Ctx) error {
	authorizationHeader := strings.TrimSpace(c.Get(fiber.HeaderAuthorization))
	if !strings.HasPrefix(authorizationHeader, "Bearer ") {
		return response.Error(c, fiber.StatusUnauthorized, response.CodeUnauthorized, "Authorization 头格式错误")
	}

	token := strings.TrimSpace(strings.TrimPrefix(authorizationHeader, "Bearer "))
	user, apiError := middleware.authService.Authenticate(c.UserContext(), token)
	if apiError != nil {
		return response.Error(c, apiError.HTTPStatus, apiError.Code, apiError.Message)
	}

	c.Locals(LocalAuthUser, user)
	c.Locals(LocalAuthUserID, user.ID)
	c.Locals(LocalAuthRole, user.Role)
	return c.Next()
}

func (middleware *AuthMiddleware) RequireAdmin(c *fiber.Ctx) error {
	roleValue := c.Locals(LocalAuthRole)
	role, ok := roleValue.(string)
	if !ok || role == "" {
		return response.Error(c, fiber.StatusForbidden, response.CodeForbidden, "无法识别用户角色")
	}
	if role != model.UserRoleAdmin {
		return response.Error(c, fiber.StatusForbidden, response.CodeForbidden, "仅管理员可访问")
	}
	return c.Next()
}
