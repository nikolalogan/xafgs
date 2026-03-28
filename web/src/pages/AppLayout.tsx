import { DeploymentUnitOutlined, HomeOutlined, LogoutOutlined, TeamOutlined, UserOutlined } from "@ant-design/icons";
import { PageContainer, ProLayout } from "@ant-design/pro-components";
import { Button, Space, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { clearAccessToken, fetchCurrentUser, getCurrentUser, type UserResponse } from "../api";

const baseMenuItems = [
  { path: "/app", name: "工作台", icon: <HomeOutlined /> },
  { path: "/app/workflow", name: "workflow", icon: <DeploymentUnitOutlined /> },
  { path: "/app/profile", name: "个人信息", icon: <UserOutlined /> }
];

const adminMenuItem = { path: "/app/users", name: "用户管理", icon: <TeamOutlined /> };

function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [currentUser, setCurrentUser] = useState<UserResponse | null>(() => getCurrentUser());

  useEffect(() => {
    const loadCurrentUser = async () => {
      try {
        const user = await fetchCurrentUser();
        setCurrentUser(user);
      } catch {
        clearAccessToken();
        navigate("/login", { replace: true });
      }
    };
    void loadCurrentUser();
  }, [navigate]);

  const menuItems = useMemo(() => {
    if (currentUser?.role === "admin") {
      return [...baseMenuItems, adminMenuItem];
    }
    return baseMenuItems;
  }, [currentUser?.role]);

  return (
    <div style={{ minHeight: "100vh" }}>
      <ProLayout
        title="SXFG Console"
        location={{ pathname: location.pathname }}
        route={{ routes: menuItems }}
        menuItemRender={(item, dom) => <Link to={item.path || "/app"}>{dom}</Link>}
        avatarProps={{
          title: currentUser?.name || currentUser?.username || "用户"
        }}
        actionsRender={() => [
          <Space key="actions" align="center">
            <Typography.Text>已登录</Typography.Text>
            <Button
              type="text"
              icon={<LogoutOutlined />}
              onClick={() => {
                clearAccessToken();
                navigate("/login");
              }}
            >
              退出
            </Button>
          </Space>
        ]}
      >
        <PageContainer>
          <Outlet />
        </PageContainer>
      </ProLayout>
    </div>
  );
}

export default AppLayout;
