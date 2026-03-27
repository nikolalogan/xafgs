import { useEffect, useState } from "react";
import { Alert, Button, Card, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  createUser,
  deleteUser,
  fetchUsers,
  type ApiError,
  type CreateUserRequest,
  type UpdateUserRequest,
  type UserResponse,
  updateUser
} from "../api";

type UserFormValues = {
  username: string;
  name: string;
  password: string;
  role: "admin" | "user";
};

const roleOptions = [
  { label: "管理员", value: "admin" },
  { label: "普通用户", value: "user" }
] as const;

function UsersPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<UserResponse[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserResponse | null>(null);
  const [createForm] = Form.useForm<UserFormValues>();
  const [editForm] = Form.useForm<UserFormValues>();

  const loadUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchUsers();
      setUsers(data);
    } catch (requestError) {
      const apiError = requestError as ApiError;
      setError(`${apiError.code}: ${apiError.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadUsers();
  }, []);

  const columns: ColumnsType<UserResponse> = [
    { title: "ID", dataIndex: "id", width: 80 },
    { title: "用户名", dataIndex: "username" },
    { title: "姓名", dataIndex: "name" },
    {
      title: "角色",
      dataIndex: "role",
      width: 120,
      render: (role: UserResponse["role"]) =>
        role === "admin" ? <Tag color="red">管理员</Tag> : <Tag color="blue">普通用户</Tag>
    },
    {
      title: "操作",
      key: "action",
      width: 220,
      render: (_, record) => (
        <Space>
          <Button
            size="small"
            onClick={() => {
              setEditUser(record);
              editForm.setFieldsValue({
                username: record.username,
                name: record.name,
                password: "",
                role: record.role
              });
            }}
          >
            编辑
          </Button>
          <Popconfirm
            title="确认删除该用户？"
            okText="删除"
            cancelText="取消"
            onConfirm={async () => {
              try {
                await deleteUser(record.id);
                message.success("删除成功");
                void loadUsers();
              } catch (requestError) {
                const apiError = requestError as ApiError;
                message.error(`${apiError.code}: ${apiError.message}`);
              }
            }}
          >
            <Button size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <Card
      title="用户管理"
      extra={
        <Button
          type="primary"
          onClick={() => {
            createForm.resetFields();
            setCreateOpen(true);
          }}
        >
          新增用户
        </Button>
      }
    >
      {error ? <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} /> : null}
      <Table<UserResponse> rowKey="id" loading={loading} dataSource={users} columns={columns} pagination={{ pageSize: 10 }} />

      <Modal
        title="新增用户"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={async () => {
          try {
            const values = await createForm.validateFields();
            const payload: CreateUserRequest = {
              username: values.username.trim(),
              name: values.name.trim(),
              password: values.password.trim(),
              role: values.role
            };
            await createUser(payload);
            message.success("创建成功");
            setCreateOpen(false);
            void loadUsers();
          } catch (requestError) {
            if (requestError instanceof Error && requestError.message.includes("out of date")) {
              return;
            }
            const apiError = requestError as ApiError;
            if (apiError.code && apiError.message) {
              message.error(`${apiError.code}: ${apiError.message}`);
            }
          }
        }}
      >
        <Form layout="vertical" form={createForm}>
          <Form.Item name="username" label="用户名" rules={[{ required: true, message: "请输入用户名" }]}>
            <Input placeholder="例如：alice" />
          </Form.Item>
          <Form.Item name="name" label="姓名" rules={[{ required: true, message: "请输入姓名" }]}>
            <Input placeholder="例如：张三" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: "请输入密码" }]}>
            <Input.Password placeholder="请输入密码" />
          </Form.Item>
          <Form.Item name="role" label="角色" rules={[{ required: true, message: "请选择角色" }]}>
            <Select options={[...roleOptions]} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="编辑用户"
        open={!!editUser}
        onCancel={() => setEditUser(null)}
        onOk={async () => {
          if (!editUser) {
            return;
          }
          try {
            const values = await editForm.validateFields();
            const payload: UpdateUserRequest = {
              name: values.name.trim(),
              password: values.password.trim(),
              role: values.role
            };
            await updateUser(editUser.id, payload);
            message.success("更新成功");
            setEditUser(null);
            void loadUsers();
          } catch (requestError) {
            if (requestError instanceof Error && requestError.message.includes("out of date")) {
              return;
            }
            const apiError = requestError as ApiError;
            if (apiError.code && apiError.message) {
              message.error(`${apiError.code}: ${apiError.message}`);
            }
          }
        }}
      >
        <Form layout="vertical" form={editForm}>
          <Form.Item name="username" label="用户名">
            <Input disabled />
          </Form.Item>
          <Form.Item name="name" label="姓名" rules={[{ required: true, message: "请输入姓名" }]}>
            <Input placeholder="请输入姓名" />
          </Form.Item>
          <Form.Item name="password" label="新密码" rules={[{ required: true, message: "请输入新密码" }]}>
            <Input.Password placeholder="请输入新密码" />
          </Form.Item>
          <Form.Item name="role" label="角色" rules={[{ required: true, message: "请选择角色" }]}>
            <Select options={[...roleOptions]} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}

export default UsersPage;
