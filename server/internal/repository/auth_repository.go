package repository

import "github.com/google/uuid"

type AuthRepository interface {
	FindUserIDByToken(token string) (int64, bool)
	IssueToken(userID int64) (string, bool)
}

type authRepository struct {
	tokenToUserID map[string]int64
}

func NewAuthRepository(apiToken string) AuthRepository {
	if apiToken == "" {
		apiToken = "dev-token"
	}
	return &authRepository{
		tokenToUserID: map[string]int64{
			apiToken: 1,
		},
	}
}

func (repository *authRepository) FindUserIDByToken(token string) (int64, bool) {
	userID, ok := repository.tokenToUserID[token]
	return userID, ok
}

func (repository *authRepository) IssueToken(userID int64) (string, bool) {
	if userID <= 0 {
		return "", false
	}
	token := uuid.NewString()
	repository.tokenToUserID[token] = userID
	return token, true
}
