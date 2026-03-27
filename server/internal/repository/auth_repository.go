package repository

type AuthRepository interface {
	FindUserIDByToken(token string) (int64, bool)
	FindTokenByCredentials(username, password string) (string, bool)
}

type authRepository struct {
	tokenToUserID      map[string]int64
	credentialsToToken map[string]string
}

func NewAuthRepository(apiToken string) AuthRepository {
	if apiToken == "" {
		apiToken = "dev-token"
	}
	return &authRepository{
		tokenToUserID: map[string]int64{
			apiToken: 1,
		},
		credentialsToToken: map[string]string{
			"developer:123456": apiToken,
		},
	}
}

func (repository *authRepository) FindUserIDByToken(token string) (int64, bool) {
	userID, ok := repository.tokenToUserID[token]
	return userID, ok
}

func (repository *authRepository) FindTokenByCredentials(username, password string) (string, bool) {
	token, ok := repository.credentialsToToken[username+":"+password]
	return token, ok
}
