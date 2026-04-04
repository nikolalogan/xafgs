package model

import "time"

type UserConfig struct {
	BaseEntity
	UserID               int64  `json:"userId"`
	WarningAccount       string `json:"warningAccount"`
	WarningPassword      string `json:"warningPassword"`
	AIBaseURL            string `json:"aiBaseUrl"`
	AIApiKey             string `json:"aiApiKey"`
	SearchServiceBaseURL string `json:"searchServiceBaseUrl"`
	SearchServiceAPIKey  string `json:"searchServiceApiKey"`
}

type UserConfigDTO struct {
	UserID               int64     `json:"userId"`
	WarningAccount       string    `json:"warningAccount"`
	WarningPassword      string    `json:"warningPassword"`
	AIBaseURL            string    `json:"aiBaseUrl"`
	AIApiKey             string    `json:"aiApiKey"`
	SearchServiceBaseURL string    `json:"searchServiceBaseUrl"`
	SearchServiceAPIKey  string    `json:"searchServiceApiKey"`
	UpdatedAt            time.Time `json:"updatedAt"`
}

type UpdateUserConfigRequest struct {
	WarningAccount       string `json:"warningAccount"`
	WarningPassword      string `json:"warningPassword"`
	AIBaseURL            string `json:"aiBaseUrl"`
	AIApiKey             string `json:"aiApiKey"`
	SearchServiceBaseURL string `json:"searchServiceBaseUrl"`
	SearchServiceAPIKey  string `json:"searchServiceApiKey"`
}

func (config UserConfig) ToDTO() UserConfigDTO {
	return UserConfigDTO{
		UserID:               config.UserID,
		WarningAccount:       config.WarningAccount,
		WarningPassword:      config.WarningPassword,
		AIBaseURL:            config.AIBaseURL,
		AIApiKey:             config.AIApiKey,
		SearchServiceBaseURL: config.SearchServiceBaseURL,
		SearchServiceAPIKey:  config.SearchServiceAPIKey,
		UpdatedAt:            config.UpdatedAt,
	}
}
