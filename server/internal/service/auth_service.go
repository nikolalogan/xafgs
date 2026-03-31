package service

import (
	"context"

	"sxfgssever/server/internal/model"
	"sxfgssever/server/internal/repository"
	"sxfgssever/server/internal/response"
)

type AuthService interface {
	Authenticate(ctx context.Context, token string) (model.UserDTO, *model.APIError)
	Login(ctx context.Context, username, password string) (model.LoginResponse, *model.APIError)
}

type authService struct {
	authRepository repository.AuthRepository
	userRepository repository.UserRepository
}

func NewAuthService(authRepository repository.AuthRepository, userRepository repository.UserRepository) AuthService {
	return &authService{
		authRepository: authRepository,
		userRepository: userRepository,
	}
}

func (service *authService) Authenticate(_ context.Context, token string) (model.UserDTO, *model.APIError) {
	if token == "" {
		return model.UserDTO{}, model.NewAPIError(401, response.CodeUnauthorized, "缺少访问令牌")
	}
	userID, ok := service.authRepository.FindUserIDByToken(token)
	if !ok {
		return model.UserDTO{}, model.NewAPIError(401, response.CodeUnauthorized, "访问令牌无效")
	}
	user, ok := service.userRepository.FindByID(userID)
	if !ok {
		return model.UserDTO{}, model.NewAPIError(401, response.CodeUnauthorized, "令牌对应用户不存在")
	}
	return user, nil
}

func (service *authService) Login(_ context.Context, username, password string) (model.LoginResponse, *model.APIError) {
	if username == "" || password == "" {
		return model.LoginResponse{}, model.NewAPIError(400, response.CodeBadRequest, "用户名和密码不能为空")
	}

	user, ok := service.userRepository.FindByUsername(username)
	if !ok || user.ID <= 0 {
		return model.LoginResponse{}, model.NewAPIError(401, response.CodeUnauthorized, "用户名或密码错误")
	}
	if user.Password != password {
		return model.LoginResponse{}, model.NewAPIError(401, response.CodeUnauthorized, "用户名或密码错误")
	}

	token, ok := service.authRepository.IssueToken(user.ID)
	if !ok {
		return model.LoginResponse{}, model.NewAPIError(500, response.CodeInternal, "生成访问令牌失败")
	}

	return model.LoginResponse{
		AccessToken: token,
		User:        user.ToDTO(),
	}, nil
}
