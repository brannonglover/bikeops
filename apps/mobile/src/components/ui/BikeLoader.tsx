import { useEffect, useRef } from "react";
import { Animated, Easing, Text, View } from "react-native";
import { useTheme } from "@/lib/ThemeContext";

const WHEEL_SPIN_MS = 550;
const TRAIL_SCROLL_MS = 385;
const BIKE_RIDE_MS = 1150;

/** Stage size — tall enough for larger wheels + saddle. */
const STAGE_W = 122;
const STAGE_H = 82;
/** viewBox origin offset so SVG coords map into the stage. */
const OX = 14;
const OY = 10;

const WHEEL_R = 18;
const FRAME = "#334155";
const AMBER = "#f59e0b";

/**
 * Playful loading indicator inspired by the bikeopsco booking widget:
 * spoked wheels spin and the bike rides along a scrolling dirt trail.
 * Built with RN Views (no native SVG module required).
 */
export function BikeLoader({ label = "Loading" }: { label?: string }) {
  const { theme } = useTheme();
  const ride = useRef(new Animated.Value(0)).current;
  const wheelSpin = useRef(new Animated.Value(0)).current;
  const trailScroll = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const rideLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(ride, {
          toValue: 1,
          duration: BIKE_RIDE_MS / 2,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(ride, {
          toValue: 0,
          duration: BIKE_RIDE_MS / 2,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );

    const wheelLoop = Animated.loop(
      Animated.timing(wheelSpin, {
        toValue: 1,
        duration: WHEEL_SPIN_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );

    const trailLoop = Animated.loop(
      Animated.timing(trailScroll, {
        toValue: 1,
        duration: TRAIL_SCROLL_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );

    rideLoop.start();
    wheelLoop.start();
    trailLoop.start();

    return () => {
      rideLoop.stop();
      wheelLoop.stop();
      trailLoop.stop();
    };
  }, [ride, wheelSpin, trailScroll]);

  const rideTranslateX = ride.interpolate({
    inputRange: [0, 1],
    outputRange: [-3, 3],
  });
  const rideRotate = ride.interpolate({
    inputRange: [0, 1],
    outputRange: ["-1deg", "1deg"],
  });
  const wheelRotate = wheelSpin.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });
  const trailTranslateX = trailScroll.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -44],
  });

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      style={{ alignItems: "center", justifyContent: "center", gap: 12 }}
    >
      <Animated.View
        style={{
          width: STAGE_W,
          height: STAGE_H,
          transform: [{ translateX: rideTranslateX }, { rotate: rideRotate }],
        }}
      >
        {/* Ground wash */}
        <View
          style={{
            position: "absolute",
            left: 0,
            top: svgY(56),
            width: STAGE_W,
            height: 24,
            backgroundColor: "rgba(146, 64, 14, 0.09)",
          }}
        />

        {/* Scrolling dirt trail */}
        <View
          style={{
            position: "absolute",
            left: 0,
            top: svgY(52),
            width: STAGE_W,
            height: 26,
            overflow: "hidden",
          }}
        >
          <Animated.View
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              flexDirection: "row",
              transform: [{ translateX: trailTranslateX }],
            }}
          >
            {[0, 1, 2, 3, 4].map((i) => (
              <TrailTile key={i} />
            ))}
          </Animated.View>
        </View>

        {/*
          Diamond-frame bike (SVG space):
          rear hub (22,40) · BB (44,40) · front hub (76,40)
          seat junction (38,15) · head junction (60,15)
        */}
        {/* Chain stay */}
        <FrameBar x1={22} y1={40} x2={44} y2={40} thickness={2.4} />
        {/* Seat stay */}
        <FrameBar x1={22} y1={40} x2={38} y2={15} thickness={2.2} />
        {/* Seat tube */}
        <FrameBar x1={44} y1={40} x2={38} y2={15} thickness={2.5} />
        {/* Down tube */}
        <FrameBar x1={44} y1={40} x2={60} y2={15} thickness={2.5} />
        {/* Top tube */}
        <FrameBar x1={38} y1={15} x2={60} y2={15} thickness={2.4} />
        {/* Head tube (short vertical) */}
        <FrameBar x1={60} y1={11} x2={60} y2={19} thickness={2.8} />
        {/* Fork */}
        <FrameBar x1={60} y1={15} x2={76} y2={40} thickness={2.3} />

        {/* Seat post + saddle */}
        <FrameBar x1={38} y1={15} x2={36} y2={5} thickness={2.1} />
        <Saddle cx={34} cy={4} />

        {/* Stem + handlebars */}
        <FrameBar x1={60} y1={11} x2={64} y2={6} thickness={2} />
        <FrameBar x1={60} y1={6} x2={72} y2={6} thickness={2.4} />
        {/* Drops / grips */}
        <FrameBar x1={60} y1={6} x2={60} y2={11} thickness={2} />
        <FrameBar x1={72} y1={6} x2={72} y2={11} thickness={2} />

        {/* Crank + pedal */}
        <FrameBar x1={44} y1={40} x2={51} y2={48} thickness={2.1} />
        <Pedal cx={53} cy={49} />
        {/* BB hub */}
        <Hub cx={44} cy={40} r={3} color={FRAME} />

        <Wheel cx={22} cy={40} rotate={wheelRotate} />
        <Wheel cx={76} cy={40} rotate={wheelRotate} />
      </Animated.View>
      <Text style={{ color: theme.textSecondary, fontSize: 16 }}>{label}</Text>
    </View>
  );
}

function svgX(x: number) {
  return x + OX;
}

function svgY(y: number) {
  return y + OY;
}

/** Line segment in SVG space, rotated around its midpoint. */
function FrameBar({
  x1,
  y1,
  x2,
  y2,
  thickness,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  thickness: number;
}) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const midX = svgX((x1 + x2) / 2);
  const midY = svgY((y1 + y2) / 2);

  return (
    <View
      style={{
        position: "absolute",
        left: midX - length / 2,
        top: midY - thickness / 2,
        width: length,
        height: thickness,
        backgroundColor: FRAME,
        borderRadius: thickness / 2,
        transform: [{ rotate: `${angle}deg` }],
      }}
    />
  );
}

function Hub({
  cx,
  cy,
  r,
  color,
}: {
  cx: number;
  cy: number;
  r: number;
  color: string;
}) {
  return (
    <View
      style={{
        position: "absolute",
        left: svgX(cx) - r,
        top: svgY(cy) - r,
        width: r * 2,
        height: r * 2,
        borderRadius: r,
        backgroundColor: color,
      }}
    />
  );
}

/** Side-profile saddle: nose forward, wider rear. */
function Saddle({ cx, cy }: { cx: number; cy: number }) {
  return (
    <View
      style={{
        position: "absolute",
        left: svgX(cx) - 9,
        top: svgY(cy) - 2.5,
        width: 18,
        height: 5,
      }}
    >
      <View
        style={{
          position: "absolute",
          left: 0,
          top: 1,
          width: 18,
          height: 3.5,
          borderRadius: 2,
          backgroundColor: FRAME,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 7,
          height: 5,
          borderRadius: 2.5,
          backgroundColor: FRAME,
        }}
      />
    </View>
  );
}

function Pedal({ cx, cy }: { cx: number; cy: number }) {
  return (
    <View
      style={{
        position: "absolute",
        left: svgX(cx) - 5,
        top: svgY(cy) - 1.5,
        width: 10,
        height: 3,
        borderRadius: 1.5,
        backgroundColor: AMBER,
      }}
    />
  );
}

function Wheel({
  cx,
  cy,
  rotate,
}: {
  cx: number;
  cy: number;
  rotate: Animated.AnimatedInterpolation<string | number>;
}) {
  const size = WHEEL_R * 2;
  return (
    <View
      style={{
        position: "absolute",
        left: svgX(cx) - WHEEL_R,
        top: svgY(cy) - WHEEL_R,
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Animated.View
        style={{
          width: size,
          height: size,
          borderRadius: WHEEL_R,
          borderWidth: 3,
          borderColor: AMBER,
          alignItems: "center",
          justifyContent: "center",
          transform: [{ rotate }],
        }}
      >
        {[0, 30, 60, 90, 120, 150].map((deg) => (
          <View
            key={deg}
            style={{
              position: "absolute",
              width: 1.5,
              height: WHEEL_R * 1.55,
              backgroundColor: AMBER,
              borderRadius: 1,
              opacity: 0.9,
              transform: [{ rotate: `${deg}deg` }],
            }}
          />
        ))}
        <View
          style={{
            width: 4.5,
            height: 4.5,
            borderRadius: 2.25,
            backgroundColor: AMBER,
          }}
        />
      </Animated.View>
    </View>
  );
}

function TrailTile() {
  return (
    <View style={{ width: 44, height: 22 }}>
      {/* Terrain line at y≈46 in SVG space → ~4px from top of this strip */}
      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 4,
          height: 1.5,
          backgroundColor: "rgba(120, 53, 15, 0.45)",
          borderRadius: 1,
        }}
      />
      {/* Grass @ offset 5 */}
      <View
        style={{
          position: "absolute",
          left: 4,
          top: 1,
          width: 1.5,
          height: 5,
          backgroundColor: "rgba(77, 124, 15, 0.7)",
          transform: [{ rotate: "-20deg" }],
        }}
      />
      <View
        style={{
          position: "absolute",
          left: 6,
          top: 1,
          width: 1.5,
          height: 5,
          backgroundColor: "rgba(77, 124, 15, 0.7)",
          transform: [{ rotate: "20deg" }],
        }}
      />
      {/* Rock @ 14 */}
      <View
        style={{
          position: "absolute",
          left: 12,
          top: 8,
          width: 6,
          height: 4,
          borderRadius: 3,
          backgroundColor: "rgba(120, 53, 15, 0.38)",
        }}
      />
      {/* Rock @ 27 */}
      <View
        style={{
          position: "absolute",
          left: 25,
          top: 9,
          width: 4,
          height: 4,
          borderRadius: 2,
          backgroundColor: "rgba(120, 53, 15, 0.3)",
        }}
      />
      {/* Grass @ 36 */}
      <View
        style={{
          position: "absolute",
          left: 35,
          top: 1.5,
          width: 1.5,
          height: 4.5,
          backgroundColor: "rgba(77, 124, 15, 0.6)",
          transform: [{ rotate: "-14deg" }],
        }}
      />
      <View
        style={{
          position: "absolute",
          left: 37,
          top: 1,
          width: 1.5,
          height: 5,
          backgroundColor: "rgba(77, 124, 15, 0.6)",
          transform: [{ rotate: "18deg" }],
        }}
      />
      {/* Rock @ 40 */}
      <View
        style={{
          position: "absolute",
          left: 38,
          top: 10,
          width: 8,
          height: 4.5,
          borderRadius: 3,
          backgroundColor: "rgba(120, 53, 15, 0.22)",
        }}
      />
    </View>
  );
}
