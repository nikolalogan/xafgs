import type { ReactNode } from "react";
import { Space, Typography } from "antd";

type Tone = "blue" | "green" | "orange";

type Props = {
  icon: ReactNode;
  label: string;
  tone?: Tone;
};

const toneStyleMap: Record<Tone, { background: string; color: string }> = {
  blue: {
    background: "linear-gradient(135deg, #eff8ff 0%, #d1e9ff 100%)",
    color: "#175cd3"
  },
  green: {
    background: "linear-gradient(135deg, #ecfdf3 0%, #dcfae6 100%)",
    color: "#067647"
  },
  orange: {
    background: "linear-gradient(135deg, #fff4ed 0%, #ffe6d5 100%)",
    color: "#b42318"
  }
};

function SectionHeaderIcon({ icon, label, tone = "blue" }: Props) {
  const style = toneStyleMap[tone];
  return (
    <Space size={8}>
      <span
        style={{
          width: 20,
          height: 20,
          borderRadius: 6,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: style.background,
          color: style.color
        }}
      >
        {icon}
      </span>
      <Typography.Text>{label}</Typography.Text>
    </Space>
  );
}

export default SectionHeaderIcon;
