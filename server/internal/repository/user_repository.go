package repository

import "sxfgssever/server/internal/model"

type UserRepository interface {
	FindByID(userID int64) (model.UserDTO, bool)
}

type userRepository struct {
	users map[int64]model.UserDTO
}

func NewUserRepository() UserRepository {
	return &userRepository{
		users: map[int64]model.UserDTO{
			1: {
				ID:       1,
				Username: "developer",
				Role:     "admin",
			},
			2: {
				ID:       2,
				Username: "guest",
				Role:     "viewer",
			},
		},
	}
}

func (repository *userRepository) FindByID(userID int64) (model.UserDTO, bool) {
	user, ok := repository.users[userID]
	return user, ok
}
