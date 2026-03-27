package repository

import (
	"sort"
	"strings"
	"time"

	"sxfgssever/server/internal/model"
)

type UserRepository interface {
	FindByID(userID int64) (model.UserDTO, bool)
	FindEntityByID(userID int64) (model.User, bool)
	FindByUsername(username string) (model.User, bool)
	FindAll() []model.UserDTO
	Create(user model.User) model.UserDTO
	Update(userID int64, update model.User) (model.UserDTO, bool)
	Delete(userID int64) bool
}

type userRepository struct {
	users      map[int64]model.User
	nextUserID int64
}

func NewUserRepository() UserRepository {
	now := time.Now().UTC()
	return &userRepository{
		users: map[int64]model.User{
			1: {
				BaseEntity: model.BaseEntity{
					ID:        1,
					CreatedAt: now,
					UpdatedAt: now,
					CreatedBy: 1,
					UpdatedBy: 1,
				},
				Username: "developer",
				Name:     "默认管理员",
				Password: "123456",
				Role:     model.UserRoleAdmin,
			},
			2: {
				BaseEntity: model.BaseEntity{
					ID:        2,
					CreatedAt: now,
					UpdatedAt: now,
					CreatedBy: 1,
					UpdatedBy: 1,
				},
				Username: "normal-user",
				Name:     "普通用户",
				Password: "123456",
				Role:     model.UserRoleNormal,
			},
		},
		nextUserID: 3,
	}
}

func (repository *userRepository) FindByID(userID int64) (model.UserDTO, bool) {
	user, ok := repository.users[userID]
	if !ok {
		return model.UserDTO{}, false
	}
	return user.ToDTO(), true
}

func (repository *userRepository) FindEntityByID(userID int64) (model.User, bool) {
	user, ok := repository.users[userID]
	return user, ok
}

func (repository *userRepository) FindByUsername(username string) (model.User, bool) {
	trimmedUsername := strings.TrimSpace(username)
	for _, user := range repository.users {
		if user.Username == trimmedUsername {
			return user, true
		}
	}
	return model.User{}, false
}

func (repository *userRepository) FindAll() []model.UserDTO {
	ids := make([]int64, 0, len(repository.users))
	for userID := range repository.users {
		ids = append(ids, userID)
	}
	sort.Slice(ids, func(i, j int) bool {
		return ids[i] < ids[j]
	})

	users := make([]model.UserDTO, 0, len(ids))
	for _, userID := range ids {
		users = append(users, repository.users[userID].ToDTO())
	}
	return users
}

func (repository *userRepository) Create(user model.User) model.UserDTO {
	now := time.Now().UTC()
	user.ID = repository.nextUserID
	user.CreatedAt = now
	user.UpdatedAt = now
	repository.users[user.ID] = user
	repository.nextUserID++
	return user.ToDTO()
}

func (repository *userRepository) Update(userID int64, update model.User) (model.UserDTO, bool) {
	existingUser, ok := repository.users[userID]
	if !ok {
		return model.UserDTO{}, false
	}

	existingUser.Name = update.Name
	existingUser.Password = update.Password
	existingUser.Role = update.Role
	existingUser.UpdatedAt = time.Now().UTC()
	existingUser.UpdatedBy = update.UpdatedBy
	repository.users[userID] = existingUser
	return existingUser.ToDTO(), true
}

func (repository *userRepository) Delete(userID int64) bool {
	if _, ok := repository.users[userID]; !ok {
		return false
	}
	delete(repository.users, userID)
	return true
}
