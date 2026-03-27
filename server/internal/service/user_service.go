package service

import (
	"context"
	"strings"

	"sxfgssever/server/internal/model"
	"sxfgssever/server/internal/repository"
	"sxfgssever/server/internal/response"
)

type UserService interface {
	GetByID(ctx context.Context, userID int64) (model.UserDTO, *model.APIError)
	List(ctx context.Context) ([]model.UserDTO, *model.APIError)
	Create(ctx context.Context, request model.CreateUserRequest, operatorID int64) (model.UserDTO, *model.APIError)
	Update(ctx context.Context, userID int64, request model.UpdateUserRequest, operatorID int64) (model.UserDTO, *model.APIError)
	Delete(ctx context.Context, userID int64) *model.APIError
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

func (service *userService) List(_ context.Context) ([]model.UserDTO, *model.APIError) {
	return service.userRepository.FindAll(), nil
}

func (service *userService) Create(
	_ context.Context,
	request model.CreateUserRequest,
	operatorID int64,
) (model.UserDTO, *model.APIError) {
	request.Username = strings.TrimSpace(request.Username)
	request.Name = strings.TrimSpace(request.Name)
	request.Password = strings.TrimSpace(request.Password)
	request.Role = strings.TrimSpace(request.Role)

	if request.Username == "" || request.Name == "" || request.Password == "" || request.Role == "" {
		return model.UserDTO{}, model.NewAPIError(400, response.CodeBadRequest, "用户名、姓名、密码、角色不能为空")
	}
	if !model.IsValidUserRole(request.Role) {
		return model.UserDTO{}, model.NewAPIError(400, response.CodeBadRequest, "角色不合法，仅支持 admin/user")
	}
	if _, exists := service.userRepository.FindByUsername(request.Username); exists {
		return model.UserDTO{}, model.NewAPIError(400, response.CodeBadRequest, "用户名已存在")
	}

	user := model.User{
		BaseEntity: model.BaseEntity{
			CreatedBy: operatorID,
			UpdatedBy: operatorID,
		},
		Username: request.Username,
		Name:     request.Name,
		Password: request.Password,
		Role:     request.Role,
	}
	return service.userRepository.Create(user), nil
}

func (service *userService) Update(
	_ context.Context,
	userID int64,
	request model.UpdateUserRequest,
	operatorID int64,
) (model.UserDTO, *model.APIError) {
	request.Name = strings.TrimSpace(request.Name)
	request.Password = strings.TrimSpace(request.Password)
	request.Role = strings.TrimSpace(request.Role)

	if request.Name == "" || request.Password == "" || request.Role == "" {
		return model.UserDTO{}, model.NewAPIError(400, response.CodeBadRequest, "姓名、密码、角色不能为空")
	}
	if !model.IsValidUserRole(request.Role) {
		return model.UserDTO{}, model.NewAPIError(400, response.CodeBadRequest, "角色不合法，仅支持 admin/user")
	}

	updatedUser, ok := service.userRepository.Update(userID, model.User{
		Name:     request.Name,
		Password: request.Password,
		Role:     request.Role,
		BaseEntity: model.BaseEntity{
			UpdatedBy: operatorID,
		},
	})
	if !ok {
		return model.UserDTO{}, model.NewAPIError(404, response.CodeNotFound, "用户不存在")
	}
	return updatedUser, nil
}

func (service *userService) Delete(_ context.Context, userID int64) *model.APIError {
	if !service.userRepository.Delete(userID) {
		return model.NewAPIError(404, response.CodeNotFound, "用户不存在")
	}
	return nil
}
