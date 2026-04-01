package model

import "time"

type UserConfig struct {
	BaseEntity
	UserID          int64  `json:"userId"`
	WarningAccount  string `json:"warningAccount"`
	WarningPassword string `json:"warningPassword"`
	AIBaseURL       string `json:"aiBaseUrl"`
	AIApiKey        string `json:"aiApiKey"`
}

type UserConfigDTO struct {
	UserID          int64     `json:"userId"`
	WarningAccount  string    `json:"warningAccount"`
	WarningPassword string    `json:"warningPassword"`
	AIBaseURL       string    `json:"aiBaseUrl"`
	AIApiKey        string    `json:"aiApiKey"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

type UpdateUserConfigRequest struct {
	WarningAccount  string `json:"warningAccount"`
	WarningPassword string `json:"warningPassword"`
	AIBaseURL       string `json:"aiBaseUrl"`
	AIApiKey        string `json:"aiApiKey"`
}

func (config UserConfig) ToDTO() UserConfigDTO {
	return UserConfigDTO{
		UserID:          config.UserID,
		WarningAccount:  config.WarningAccount,
		WarningPassword: config.WarningPassword,
		AIBaseURL:       config.AIBaseURL,
		AIApiKey:        config.AIApiKey,
		UpdatedAt:       config.UpdatedAt,
	}
}
