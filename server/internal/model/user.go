package model

type User struct {
	BaseEntity
	Username string `json:"username"`
	Name     string `json:"name"`
	Password string `json:"password,omitempty"`
	Role     string `json:"role"`
}

type UserDTO struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
	Name     string `json:"name"`
	Role     string `json:"role"`
}

func (user User) ToDTO() UserDTO {
	return UserDTO{
		ID:       user.ID,
		Username: user.Username,
		Name:     user.Name,
		Role:     user.Role,
	}
}
