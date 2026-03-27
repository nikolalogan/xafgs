type Props = {
  id: string;
  startColor: string;
  stopColor: string;
  position: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  };
};

function CustomEdgeLinearGradientRender({ id, startColor, stopColor, position }: Props) {
  return (
    <svg style={{ position: "absolute", width: 0, height: 0 }}>
      <defs>
        <linearGradient id={id} x1={position.x1} y1={position.y1} x2={position.x2} y2={position.y2} gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={startColor} />
          <stop offset="100%" stopColor={stopColor} />
        </linearGradient>
      </defs>
    </svg>
  );
}

export default CustomEdgeLinearGradientRender;

