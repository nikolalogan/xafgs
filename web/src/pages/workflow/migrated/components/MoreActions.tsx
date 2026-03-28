import { Button, Dropdown, type MenuProps } from "antd";
import { MoreOutlined } from "@ant-design/icons";

type Props = {
  onFitView: () => void;
  onAutoLayout: () => void;
  onReset: () => void;
};

function MoreActions({ onFitView, onAutoLayout, onReset }: Props) {
  const items: MenuProps["items"] = [
    { key: "fit", label: "适配视图" },
    { key: "layout", label: "自动整理布局" },
    { type: "divider" },
    { key: "reset", label: "重置到模板" }
  ];

  return (
    <Dropdown
      menu={{
        items,
        onClick: ({ key }) => {
          if (key === "fit") onFitView();
          if (key === "layout") onAutoLayout();
          if (key === "reset") onReset();
        }
      }}
      trigger={["click"]}
    >
      <Button icon={<MoreOutlined />} />
    </Dropdown>
  );
}

export default MoreActions;

