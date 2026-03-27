package model

type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type LoginResponse struct {
	AccessToken string  `json:"accessToken"`
	User        UserDTO `json:"user"`
}
