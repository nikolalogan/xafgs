import axios, { AxiosError, type AxiosInstance, type AxiosRequestConfig } from "axios";

const ACCESS_TOKEN_KEY = "sxfg_access_token";
const CURRENT_USER_KEY = "sxfg_current_user";

export type ApiResponse<T> = {
  statusCode: number;
  code: string;
  message: string;
  data?: T;
  requestId: string;
  timestamp: string;
};

export type ApiError = {
  statusCode: number;
  code: string;
  message: string;
  requestId?: string;
};

export type HealthResponse = {
  status: string;
  service: string;
  timestamp: string;
};

export type UserResponse = {
  id: number;
  username: string;
  name: string;
  role: "admin" | "user";
};

export type CreateUserRequest = {
  username: string;
  name: string;
  password: string;
  role: "admin" | "user";
};

export type UpdateUserRequest = {
  name: string;
  password: string;
  role: "admin" | "user";
};

export type LoginResponse = {
  accessToken: string;
  user: UserResponse;
};

const client: AxiosInstance = axios.create({
  baseURL: "/api",
  timeout: 5000
});

client.interceptors.request.use((config) => {
  const token = getAccessToken();
  const headers = config.headers;
  if (token && headers) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (headers) {
    headers["X-Request-ID"] = crypto.randomUUID();
  }
  return config;
});

client.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiResponse<never>>) => {
    throw parseApiError(error);
  }
);

export function setAccessToken(token: string) {
  localStorage.setItem(ACCESS_TOKEN_KEY, token);
}

export function getAccessToken(): string {
  return localStorage.getItem(ACCESS_TOKEN_KEY) ?? "";
}

export function clearAccessToken() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(CURRENT_USER_KEY);
}

export function setCurrentUser(user: UserResponse) {
  localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(user));
}

export function getCurrentUser(): UserResponse | null {
  const payload = localStorage.getItem(CURRENT_USER_KEY);
  if (!payload) {
    return null;
  }
  try {
    return JSON.parse(payload) as UserResponse;
  } catch {
    return null;
  }
}

export async function fetchHealth() {
  return request<HealthResponse>({
    method: "GET",
    url: "/health"
  });
}

export async function login(username: string, password: string) {
  return request<LoginResponse>({
    method: "POST",
    url: "/auth/login",
    data: {
      username,
      password
    }
  });
}

export async function fetchCurrentUser() {
  const user = await request<UserResponse>({
    method: "GET",
    url: "/me"
  });
  setCurrentUser(user);
  return user;
}

export async function fetchUserByID(userID: number) {
  return request<UserResponse>({
    method: "GET",
    url: `/users/${userID}`
  });
}

export async function fetchUsers() {
  return request<UserResponse[]>({
    method: "GET",
    url: "/users"
  });
}

export async function createUser(data: CreateUserRequest) {
  return request<UserResponse>({
    method: "POST",
    url: "/users",
    data
  });
}

export async function updateUser(userID: number, data: UpdateUserRequest) {
  return request<UserResponse>({
    method: "PUT",
    url: `/users/${userID}`,
    data
  });
}

export async function deleteUser(userID: number) {
  return request<boolean>({
    method: "DELETE",
    url: `/users/${userID}`
  });
}

async function request<T>(config: AxiosRequestConfig): Promise<T> {
  const response = await client.request<ApiResponse<T>>(config);
  const payload = response.data;
  if (payload.code !== "SUCCESS") {
    throw {
      statusCode: payload.statusCode ?? response.status,
      code: payload.code ?? "UNKNOWN_ERROR",
      message: payload.message ?? "请求失败",
      requestId: payload.requestId
    } as ApiError;
  }
  if (payload.data === undefined) {
    throw {
      statusCode: payload.statusCode ?? response.status,
      code: "EMPTY_DATA",
      message: "响应缺少 data 字段",
      requestId: payload.requestId
    } as ApiError;
  }
  return payload.data;
}

function parseApiError(error: AxiosError<ApiResponse<never>>): ApiError {
  const statusCode = error.response?.status ?? 500;
  const payload = error.response?.data;
  if (payload) {
    return {
      statusCode: payload.statusCode ?? statusCode,
      code: payload.code ?? "UNKNOWN_ERROR",
      message: payload.message ?? "请求失败",
      requestId: payload.requestId
    };
  }

  if (error.code === "ECONNABORTED") {
    return {
      statusCode: 408,
      code: "TIMEOUT",
      message: "请求超时"
    };
  }

  return {
    statusCode,
    code: "NETWORK_ERROR",
    message: "网络异常或服务不可用"
  };
}
