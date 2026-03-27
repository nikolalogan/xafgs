package service

import (
	"context"

	"sxfgssever/server/internal/model"
	"sxfgssever/server/internal/repository"
	"sxfgssever/server/internal/response"
)

type UserService interface {
	GetByID(ctx context.Context, userID int64) (model.UserDTO, *model.APIError)
}

type userService struct {
	userRepository repository.UserRepository
}

func NewUserService(userRepository repository.UserRepository) UserService {
	return &userService{
		userRepository: userRepository,
	}
}

func (service *userService) GetByID(_ context.Context, userID int64) (model.UserDTO, *model.APIError) {
	user, ok := service.userRepository.FindByID(userID)
	if !ok {
		return model.UserDTO{}, model.NewAPIError(404, response.CodeNotFound, "用户不存在")
	}
	return user, nil
}
