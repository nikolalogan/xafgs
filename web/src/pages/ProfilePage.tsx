import { useEffect, useState } from "react";
import { Alert, Card, Descriptions, Spin } from "antd";
import { fetchCurrentUser, type ApiError, type UserResponse } from "../api";

function ProfilePage() {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<UserResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadUser = async () => {
      try {
        const currentUser = await fetchCurrentUser();
        setUser(currentUser);
      } catch (requestError) {
        const apiError = requestError as ApiError;
        setError(`${apiError.code}: ${apiError.message}`);
      } finally {
        setLoading(false);
      }
    };
    void loadUser();
  }, []);

  if (loading) {
    return (
      <Card>
        <Spin />
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <Alert type="error" message={error} showIcon />
      </Card>
    );
  }

  return (
    <Card>
      <Descriptions title="当前登录用户" column={1} bordered>
        <Descriptions.Item label="ID">{user?.id}</Descriptions.Item>
        <Descriptions.Item label="用户名">{user?.username}</Descriptions.Item>
        <Descriptions.Item label="姓名">{user?.name}</Descriptions.Item>
        <Descriptions.Item label="角色">{user?.role}</Descriptions.Item>
      </Descriptions>
    </Card>
  );
}

export default ProfilePage;
