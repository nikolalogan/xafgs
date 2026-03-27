package model

const (
	UserRoleAdmin  = "admin"
	UserRoleNormal = "user"
)

func IsValidUserRole(role string) bool {
	return role == UserRoleAdmin || role == UserRoleNormal
}
