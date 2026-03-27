package model

type UserDTO struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
	Role     string `json:"role"`
}
