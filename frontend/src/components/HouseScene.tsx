import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  Environment,
  Lightformer,
  Line,
  OrbitControls,
  RoundedBox,
} from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { APPLIANCES, ROOMS, type ApplianceId, type RoomId } from "../data/contract";

/** State of the house for the selected hour. */
export type TwinView = {
  roomLoad: Record<RoomId, number>;
  solarNow: number;
  gridNow: number;
  byAppliance: Record<ApplianceId, number>;
};

type RoomBox = {
  id: RoomId;
  label: string;
  pos: [number, number, number];
  size: [number, number];
};

/** Scene colours per theme; HouseScene sets P before rendering the canvas. */
const PALETTES = {
  bright: {
    sky: "#cde8ff",
    hemiSky: "#ffffff",
    hemiGround: "#6fae52",
    ground: "#8fcb6c",
    gridMajor: "#79b95a",
    gridMinor: "#83c163",
    slab: "#dccaa8",
    floor: "#f0d3a6",
    wall: "#fbfbfd",
    wallSelected: "#bfdbfe",
    pylon: "#64748b",
    grid: "#0d9488",
    sun: "#f59e0b",
    ambient: 0.55,
    glowBoost: 1.5,
    trees: true,
    label: "#334155",
  },
  dark: {
    sky: "#181d24",
    hemiSky: "#7fd4e0",
    hemiGround: "#1c222b",
    ground: "#1f242c",
    gridMajor: "#2b323c",
    gridMinor: "#22272f",
    slab: "#242a33",
    floor: "#2b323c",
    wall: "#3a4452",
    wallSelected: "#526071",
    pylon: "#4a5462",
    grid: "#5fe7d6",
    sun: "#ffc94d",
    ambient: 0.45,
    glowBoost: 1,
    trees: false,
    label: "#cbd5e1",
  },
};
let P = PALETTES.bright;

/** Five room slots in the 3D house; scenario.json rooms fill them in order (max 5). */
const SLOTS: Pick<RoomBox, "pos" | "size">[] = [
  { pos: [1.9, 0, -1.4], size: [4.2, 3.0] },
  { pos: [-2.1, 0, -1.6], size: [3.4, 2.6] },
  { pos: [-2.1, 0, 1.8], size: [3.4, 3.2] },
  { pos: [0.6, 0, 1.9], size: [1.8, 3.0] },
  { pos: [3.3, 0, 1.9], size: [3.4, 3.0] },
];

function layout(): RoomBox[] {
  return ROOMS.slice(0, SLOTS.length).map((r, i) => ({ id: r.id, label: r.label, ...SLOTS[i] }));
}

function loadColor(kw: number) {
  // teal -> amber as load increases
  const t = Math.min(1, kw / 4);

  return new THREE.Color().setHSL(
    THREE.MathUtils.lerp(0.5, 0.09, t),
    0.75,
    THREE.MathUtils.lerp(0.42, 0.55, t)
  );
}

function Room({
  box,
  kw,
  selected,
  onSelect,
  onHover,
  children,
}: {
  box: RoomBox;
  kw: number;
  selected: boolean;
  onSelect: () => void;
  onHover: (hovered: boolean) => void;
  children?: React.ReactNode;
}) {
  const group = useRef<THREE.Group>(null);
  const glow = useRef<THREE.Mesh>(null);

  const [hovered, setHovered] = useState(false);

  const color = useMemo(() => loadColor(kw), [kw]);

  const [w, d] = box.size;

  useFrame(({ clock }) => {
    if (!group.current) return;

    const pulse =
      0.25 + 0.14 * Math.sin(clock.elapsedTime * (1 + kw * 0.5));

    const targetY = selected ? 0.2 : hovered ? 0.12 : 0;

    group.current.position.y = THREE.MathUtils.lerp(
      group.current.position.y,
      targetY,
      0.12
    );

    const targetScale = selected ? 1.025 : hovered ? 1.012 : 1;

    group.current.scale.x = THREE.MathUtils.lerp(
      group.current.scale.x,
      targetScale,
      0.12
    );

    group.current.scale.y = THREE.MathUtils.lerp(
      group.current.scale.y,
      targetScale,
      0.12
    );

    group.current.scale.z = THREE.MathUtils.lerp(
      group.current.scale.z,
      targetScale,
      0.12
    );

    if (glow.current) {
      const material = glow.current.material as THREE.MeshBasicMaterial;

      material.opacity = Math.min(
        0.95,
        ((selected ? 0.58 : hovered ? 0.42 : 0.18) + pulse * Math.min(1, kw / 3)) * P.glowBoost
      );
    }
  });

  const handleHover = (value: boolean) => {
    setHovered(value);
    onHover(value);
  };

  return (
    <group
      ref={group}
      position={box.pos}
      onPointerOver={(e) => {
        e.stopPropagation();
        handleHover(true);
      }}
      onPointerOut={(e) => {
        e.stopPropagation();
        handleHover(false);
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      {/* Floor */}
      <mesh
        position-y={0.06}
        rotation-x={-Math.PI / 2}
        receiveShadow
      >
        <planeGeometry args={[w, d]} />

        <meshStandardMaterial
          color={P.floor}
          roughness={0.85}
          metalness={0.05}
        />
      </mesh>

      {/* Energy glow */}
      <mesh
        ref={glow}
        position-y={0.08}
        rotation-x={-Math.PI / 2}
      >
        <planeGeometry args={[w - 0.12, d - 0.12]} />

        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.3}
          toneMapped={false}
        />
      </mesh>

      {/* Room walls */}
      {[
        {
          x: 0,
          z: -d / 2,
          sx: w,
          sz: 0.06,
        },
        {
          x: 0,
          z: d / 2,
          sx: w,
          sz: 0.06,
        },
        {
          x: -w / 2,
          z: 0,
          sx: 0.06,
          sz: d,
        },
        {
          x: w / 2,
          z: 0,
          sx: 0.06,
          sz: d,
        },
      ].map((wall, i) => (
        <mesh
          key={i}
          position={[wall.x, 0.34, wall.z]}
          castShadow
        >
          <boxGeometry args={[wall.sx, 0.56, wall.sz]} />

          <meshStandardMaterial
            color={selected ? P.wallSelected : P.wall}
            roughness={0.7}
          />
        </mesh>
      ))}

      {/* Energy tower */}
      <mesh
        position={[
          w / 2 - 0.45,
          0.1 + Math.min(kw, 8) * 0.09,
          -d / 2 + 0.45,
        ]}
        castShadow
      >
        <boxGeometry
          args={[
            0.2,
            Math.max(0.08, Math.min(kw, 8) * 0.18),
            0.2,
          ]}
        />

        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={1.7}
          toneMapped={false}
        />
      </mesh>

      {/* Small center energy core */}
      <mesh position={[0, 0.16, 0]}>
        <sphereGeometry args={[0.075 + kw * 0.015, 12, 12]} />

        <meshBasicMaterial
          color={color}
          transparent
          opacity={selected ? 0.9 : 0.55}
          toneMapped={false}
        />
      </mesh>

      {/* Windows */}
      <mesh
        position={[0, 0.78, -d / 2 - 0.012]}
      >
        <planeGeometry args={[Math.min(w * 0.35, 1.2), 0.38]} />

        <meshBasicMaterial
          color={color}
          transparent
          opacity={Math.min(0.85, 0.2 + kw / 5)}
          toneMapped={false}
        />
      </mesh>
      {children}
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/* Solar roof                                                                  */
/* -------------------------------------------------------------------------- */

function SolarRoof({ yieldKw }: { yieldKw: number }) {
  const glowRef = useRef<THREE.MeshStandardMaterial>(null);

  useFrame(({ clock }) => {
    if (!glowRef.current) return;

    glowRef.current.emissiveIntensity =
      0.2 +
      Math.min(1.4, yieldKw / 3) *
        (0.8 + 0.2 * Math.sin(clock.elapsedTime * 2));
  });

  const panels = Array.from({ length: 12 });

  return (
    <group
      position={[3.3, 1.35, 1.9]}
      rotation-x={-Math.PI / 2.4}
    >
      {panels.map((_, i) => {
        const x = (i % 4) * 0.7 - 1.05;
        const z = Math.floor(i / 4) * 0.65 - 0.65;

        return (
          <mesh
            key={i}
            position={[x, z, 0]}
            castShadow
          >
            <boxGeometry args={[0.62, 0.48, 0.045]} />

            <meshStandardMaterial
              ref={i === 0 ? glowRef : undefined}
              color="#14303a"
              emissive="#ffc94d"
              emissiveIntensity={0.3}
              metalness={0.7}
              roughness={0.25}
              toneMapped={false}
            />
          </mesh>
        );
      })}
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/* Energy particles                                                            */
/* -------------------------------------------------------------------------- */

function EnergyParticles({
  from,
  to,
  intensity,
  color,
  reverse = false,
}: {
  from: THREE.Vector3;
  to: THREE.Vector3;
  intensity: number;
  color: string;
  reverse?: boolean;
}) {
  const group = useRef<THREE.Group>(null);

  const count = 10;

  useFrame(({ clock }) => {
    if (!group.current) return;

    const speed =
      0.25 + Math.min(1.5, intensity / 5);

    group.current.children.forEach((child, i) => {
      let t =
        (clock.elapsedTime * speed + i / count) % 1;

      if (reverse) {
        t = 1 - t;
      }

      child.position.lerpVectors(from, to, t);

      const pulse =
        0.055 +
        0.035 * Math.sin(t * Math.PI);

      child.scale.setScalar(pulse);
    });
  });

  return (
    <group ref={group}>
      {Array.from({ length: count }).map((_, i) => (
        <mesh key={i}>
          <sphereGeometry args={[1, 8, 8]} />

          <meshBasicMaterial
            color={color}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/* Grid connection                                                            */
/* -------------------------------------------------------------------------- */

function GridPylon() {
  return (
    <group position={[-8.5, 0, 3.2]}>
      <mesh position-y={1.1} castShadow>
        <cylinderGeometry args={[0.07, 0.11, 2.2, 8]} />

        <meshStandardMaterial
          color={P.pylon}
          roughness={0.6}
        />
      </mesh>

      <mesh position-y={1.9}>
        <boxGeometry args={[1.3, 0.09, 0.09]} />

        <meshStandardMaterial color={P.pylon} />
      </mesh>

      <mesh position={[-0.5, 1.75, 0]}>
        <boxGeometry args={[0.08, 0.5, 0.08]} />

        <meshStandardMaterial color={P.pylon} />
      </mesh>

      <mesh position={[0.5, 1.75, 0]}>
        <boxGeometry args={[0.08, 0.5, 0.08]} />

        <meshStandardMaterial color={P.pylon} />
      </mesh>
    </group>
  );
}

function EnergyFlow({
  intensity,
  solarNow,
}: {
  intensity: number;
  solarNow: number;
}) {
  const grid = useMemo(
    () => new THREE.Vector3(-8.5, 1.6, 3.2),
    []
  );

  const house = useMemo(
    () => new THREE.Vector3(-3.4, 0.5, 2.4),
    []
  );

  const solar = useMemo(
    () => new THREE.Vector3(3.3, 1.6, 1.9),
    []
  );

  const houseCenter = useMemo(
    () => new THREE.Vector3(1.2, 0.7, 0),
    []
  );

  return (
    <>
      <GridPylon />

      <Line
        points={[
          grid.toArray(),
          house.toArray(),
        ]}
        color={P.grid}
        transparent
        opacity={0.16}
        lineWidth={1}
      />

      <Line
        points={[
          solar.toArray(),
          houseCenter.toArray(),
        ]}
        color={P.sun}
        transparent
        opacity={0.18}
        lineWidth={1}
      />

      <EnergyParticles
        from={grid}
        to={house}
        intensity={intensity}
        color={P.grid}
      />

      <EnergyParticles
        from={solar}
        to={houseCenter}
        intensity={solarNow}
        color={P.sun}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Decorative garden (bright theme)                                           */
/* -------------------------------------------------------------------------- */

const TREES: { pos: [number, number, number]; scale: number; color: string }[] = [
  { pos: [-9.6, 0, -6.4], scale: 1.2, color: "#2f9e57" },
  { pos: [-7.4, 0, -8.6], scale: 0.9, color: "#3fb46a" },
  { pos: [10.4, 0, -6.2], scale: 1.1, color: "#2f9e57" },
  { pos: [11.4, 0, 2.4], scale: 0.8, color: "#4cc07a" },
  { pos: [9.2, 0, 8.4], scale: 1.0, color: "#3fb46a" },
  { pos: [-9.8, 0, 7.6], scale: 1.15, color: "#2f9e57" },
  { pos: [-2.2, 0, 10.2], scale: 0.75, color: "#4cc07a" },
];

function Garden() {
  const trees = useRef<(THREE.Group | null)[]>([]);

  // Trees sway gently in the breeze
  useFrame(({ clock }) => {
    trees.current.forEach((tree, i) => {
      if (tree) tree.rotation.z = Math.sin(clock.elapsedTime * 0.9 + i * 1.7) * 0.035;
    });
  });

  return (
    <group>
      {TREES.map((t, i) => (
        <group
          key={i}
          ref={(el) => {
            trees.current[i] = el;
          }}
          position={t.pos}
          scale={t.scale}
        >
          <mesh position-y={0.45} castShadow>
            <cylinderGeometry args={[0.09, 0.12, 0.9, 8]} />
            <meshStandardMaterial color="#8b5a2b" roughness={0.9} />
          </mesh>
          <mesh position-y={1.3} castShadow>
            <coneGeometry args={[0.6, 1.3, 10]} />
            <meshStandardMaterial color={t.color} roughness={0.7} />
          </mesh>
          <mesh position-y={1.9} castShadow>
            <coneGeometry args={[0.42, 0.9, 10]} />
            <meshStandardMaterial color={t.color} roughness={0.7} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Soft clouds drifting behind the house (bright theme). */
const CLOUDS: { x: number; y: number; z: number; scale: number; speed: number }[] = [
  { x: -12, y: 4.2, z: -11, scale: 1.3, speed: 0.35 },
  { x: -2, y: 5.0, z: -13, scale: 1.0, speed: 0.25 },
  { x: 7, y: 4.6, z: -10, scale: 1.15, speed: 0.3 },
  { x: 15, y: 5.4, z: -14, scale: 0.9, speed: 0.2 },
];

function Clouds() {
  const clouds = useRef<(THREE.Group | null)[]>([]);

  useFrame((_, delta) => {
    clouds.current.forEach((cloud, i) => {
      if (!cloud) return;
      cloud.position.x += CLOUDS[i].speed * delta;
      if (cloud.position.x > 20) cloud.position.x = -20;
    });
  });

  return (
    <group>
      {CLOUDS.map((c, i) => (
        <group
          key={i}
          ref={(el) => {
            clouds.current[i] = el;
          }}
          position={[c.x, c.y, c.z]}
          scale={c.scale}
        >
          {[
            [0, 0, 0, 0.9],
            [0.9, -0.15, 0.1, 0.7],
            [-0.9, -0.2, 0, 0.65],
            [0.35, 0.35, -0.1, 0.6],
          ].map(([x, y, z, r], k) => (
            <mesh key={k} position={[x, y, z]}>
              <sphereGeometry args={[r, 16, 16]} />
              <meshStandardMaterial color="#ffffff" roughness={1} transparent opacity={0.92} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/* Camera focus                                                               */
/* -------------------------------------------------------------------------- */

function CameraFocus({
  selected,
}: {
  selected: RoomId | null;
}) {
  const { camera, controls } = useThree();

  const targetPosition = useMemo(
    () => new THREE.Vector3(),
    []
  );

  const targetLookAt = useMemo(
    () => new THREE.Vector3(),
    []
  );

  // Fly the camera only after the selection changes, then hand control back
  // to OrbitControls so auto-rotate and dragging are not overridden.
  // The flight ends when the camera is close enough or after 1.5 s at most — auto-rotate keeps
  // moving the camera, so waiting for an exact match would lock the view.
  const flying = useRef(false);
  const flightStart = useRef(0);
  useEffect(() => {
    flying.current = true;
    flightStart.current = performance.now();
  }, [selected]);

  useFrame(() => {
    if (!flying.current) return;
    if (performance.now() - flightStart.current > 1500) {
      flying.current = false;
      return;
    }

    const selectedRoom = layout().find(
      (room) => room.id === selected
    );

    if (selectedRoom) {
      targetPosition.set(
        selectedRoom.pos[0] + 5.2,
        6.2,
        selectedRoom.pos[2] + 5.2
      );

      targetLookAt.set(
        selectedRoom.pos[0],
        0.4,
        selectedRoom.pos[2]
      );
    } else {
      targetPosition.set(11, 13, 16);

      targetLookAt.set(0.6, 0.5, 0.2);
    }

    camera.position.lerp(targetPosition, 0.06);

    const orbit = controls as any;

    if (orbit?.target) {
      orbit.target.lerp(targetLookAt, 0.08);
      orbit.update();
    }

    if (
      camera.position.distanceTo(targetPosition) < 0.5 &&
      (!orbit?.target || orbit.target.distanceTo(targetLookAt) < 0.1)
    ) {
      flying.current = false;
    }
  });

  return null;
}

/* -------------------------------------------------------------------------- */
/* DOM label projection                                                       */
/* -------------------------------------------------------------------------- */

function LabelProjector({
  refs,
}: {
  refs: React.RefObject<
    (HTMLDivElement | null)[]
  >;
}) {
  const v = useRef(new THREE.Vector3());

  useFrame(({ camera, size }) => {
    layout().forEach((box, i) => {
      const el = refs.current?.[i];

      if (!el) return;

      v.current
        .set(box.pos[0], 1.35, box.pos[2])
        .project(camera);

      const x =
        (v.current.x * 0.5 + 0.5) *
        size.width;

      const y =
        (-v.current.y * 0.5 + 0.5) *
        size.height;

      el.style.transform = `
        translate3d(${x}px, ${y}px, 0)
        translate(-50%, -50%)
      `;
    });
  });

  return null;
}

/* -------------------------------------------------------------------------- */
/* Room HUD                                                                   */
/* -------------------------------------------------------------------------- */

function RoomHUD({
  twin,
  selected,
  onClose,
}: {
  twin: TwinView;
  selected: RoomId;
  onClose: () => void;
}) {
  const room = layout().find(
    (item) => item.id === selected
  );

  if (!room) return null;

  const kw = (twin.roomLoad[selected] ?? 0);

  const percentage = Math.min(
    100,
    (kw / 4) * 100
  );

  return (
    <div className="pointer-events-auto absolute bottom-4 left-4 z-30 w-64 rounded-xl border border-border bg-card/90 p-4 shadow-2xl backdrop-blur-md">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Energy monitor
          </div>

          <div className="text-base font-semibold">
            {room.label}
          </div>
        </div>

        <button
          onClick={onClose}
          className="rounded-md px-2 py-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          ×
        </button>
      </div>

      <div className="mb-4 flex items-end justify-between">
        <div>
          <div className="metric text-2xl font-semibold">
            {kw.toFixed(2)}
          </div>

          <div className="text-xs text-muted-foreground">
            kW current load
          </div>
        </div>

        <div className="rounded-md bg-primary/10 px-2 py-1 text-xs text-primary">
          LIVE
        </div>
      </div>

      <div className="mb-4">
        <div className="mb-1 flex justify-between text-[11px] uppercase tracking-wider text-muted-foreground">
          <span>Load</span>
          <span>{percentage.toFixed(0)}%</span>
        </div>

        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500"
            style={{
              width: `${percentage}%`,
            }}
          />
        </div>
      </div>

      <div className="space-y-2 text-xs">
        <div className="flex justify-between">
          <span className="text-muted-foreground">
            Solar output
          </span>

          <span className="metric">
            {twin.solarNow.toFixed(2)} kW
          </span>
        </div>

        <div className="flex justify-between">
          <span className="text-muted-foreground">
            Grid flow
          </span>

          <span className="metric">
            {twin.gridNow.toFixed(2)} kW
          </span>
        </div>
      </div>

      <div className="mt-3 space-y-1 border-t border-border pt-3 text-xs">
        {APPLIANCES.filter((a) => a.room === selected).map((a) => (
          <div key={a.id} className="flex justify-between">
            <span className={(twin.byAppliance[a.id] ?? 0) > 0.005 ? "" : "text-muted-foreground"}>{a.name}</span>
            <span className="metric">{(twin.byAppliance[a.id] ?? 0).toFixed(2)} kWh</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Main scene                                                                 */
/* -------------------------------------------------------------------------- */

export function HouseScene({
  twin,
  selected,
  onSelect,
  theme = "bright",
}: {
  twin: TwinView;
  selected: RoomId | null;
  onSelect: (r: RoomId | null) => void;
  theme?: "bright" | "dark";
}) {
  P = PALETTES[theme];
  const labelRefs = useRef<
    (HTMLDivElement | null)[]
  >([]);

  const [hoveredRoom, setHoveredRoom] =
    useState<RoomId | null>(null);
  const [rotating, setRotating] = useState(true);

  return (
    <div className="relative h-full w-full">
      <button
        onClick={() => setRotating((r) => !r)}
        aria-pressed={rotating}
        title={rotating ? "Pause rotation" : "Rotate the house"}
        className="absolute left-3 bottom-10 z-30 rounded-lg border border-border bg-card/85 px-3 py-1.5 text-xs font-medium shadow-sm backdrop-blur-md transition-all hover:-translate-y-0.5"
      >
        {rotating ? "⏸ Pause rotation" : "⟳ Rotate"}
      </button>
      {/* ------------------------------------------------------------------ */}
      {/* Room labels                                                         */}
      {/* ------------------------------------------------------------------ */}

      <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
        {layout().map((box, i) => {
          const isSelected =
            selected === box.id;

          const isHovered =
            hoveredRoom === box.id;

          return (
            <div
              key={box.id}
              ref={(el) => {
                labelRefs.current[i] = el;
              }}
              className={`
                metric absolute left-0 top-0
                whitespace-nowrap rounded-md
                border px-2 py-1
                text-[11px] leading-tight
                backdrop-blur-sm
                transition-all duration-200
                ${
                  isSelected
                    ? "border-primary bg-primary/15 text-primary shadow-[0_0_18px_rgba(95,231,214,0.18)]"
                    : isHovered
                    ? "border-primary/60 bg-card text-foreground"
                    : "border-border bg-card/80 text-foreground"
                }
              `}
            >
              <span className="font-sans">
                {box.label}
              </span>

              <span className="opacity-70">
                {" "}
                ·{" "}
              </span>

              <span>
                {(twin.roomLoad[box.id] ?? 0).toFixed(2)}{" "}
                kW
              </span>
            </div>
          );
        })}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Room HUD                                                            */}
      {/* ------------------------------------------------------------------ */}

      {selected && (
        <RoomHUD
          twin={twin}
          selected={selected}
          onClose={() => onSelect(null)}
        />
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Overview indicator                                                  */}
      {/* ------------------------------------------------------------------ */}

      {selected && (
        <button
          onClick={() => onSelect(null)}
          className="pointer-events-auto absolute right-4 top-4 z-30 rounded-lg border border-border bg-card/80 px-3 py-2 text-xs backdrop-blur-md transition hover:bg-card"
        >
          ← Overview
        </button>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Canvas                                                              */}
      {/* ------------------------------------------------------------------ */}

      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{
          position: [11, 13, 16],
          fov: 40,
        }}
        gl={{
          antialias: true,
        }}
        onPointerMissed={() => {
          if (selected) {
            onSelect(null);
          }
        }}
      >
        {/* Environment */}
        <color
          attach="background"
          args={[P.sky]}
        />

        <fog
          attach="fog"
          args={[
            P.sky,
            22,
            46,
          ]}
        />

        <ambientLight intensity={P.ambient} />

        <hemisphereLight
          args={[
            P.hemiSky,
            P.hemiGround,
            0.5,
          ]}
        />

        <directionalLight
          position={[8, 14, 6]}
          intensity={1.1}
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
          shadow-camera-left={-14}
          shadow-camera-right={14}
          shadow-camera-top={14}
          shadow-camera-bottom={-14}
        />

        <Environment>
          <Lightformer
            intensity={1.6}
            position={[0, 6, 0]}
            scale={[12, 12, 1]}
          />

          <Lightformer
            intensity={0.8}
            color={P.grid}
            position={[-6, 2, 2]}
            rotation-y={Math.PI / 2}
            scale={[16, 2, 1]}
          />
        </Environment>

        {/* ---------------------------------------------------------------- */}
        {/* Ground                                                            */}
        {/* ---------------------------------------------------------------- */}

        <mesh
          rotation-x={-Math.PI / 2}
          receiveShadow
          onClick={(e) => {
            e.stopPropagation();

            if (selected) {
              onSelect(null);
            }
          }}
        >
          <planeGeometry args={[60, 60]} />

          <meshStandardMaterial
            color={P.ground}
            roughness={0.95}
          />
        </mesh>

        <gridHelper
          args={[
            60,
            60,
            P.gridMajor,
            P.gridMinor,
          ]}
          position-y={0.005}
        />

        {/* ---------------------------------------------------------------- */}
        {/* House slab                                                        */}
        {/* ---------------------------------------------------------------- */}

        <RoundedBox
          position={[0.6, 0.02, 0.2]}
          args={[11.4, 0.1, 7.6]}
          radius={0.08}
          smoothness={3}
          receiveShadow
        >
          <meshStandardMaterial
            color={P.slab}
            roughness={0.9}
          />
        </RoundedBox>

        {/* ---------------------------------------------------------------- */}
        {/* Rooms                                                             */}
        {/* ---------------------------------------------------------------- */}

        {layout().map((box) => (
          <Room
            key={box.id}
            box={box}
            kw={twin.roomLoad[box.id] ?? 0}
            selected={selected === box.id}
            onHover={(value) => {
              setHoveredRoom(
                value ? box.id : null
              );
            }}
            onSelect={() => {
              onSelect(
                selected === box.id
                  ? null
                  : box.id
              );
            }}
          >
          </Room>
        ))}

        {/* ---------------------------------------------------------------- */}
        {/* Solar                                                             */}
        {/* ---------------------------------------------------------------- */}

        <SolarRoof
          yieldKw={twin.solarNow}
        />

        {/* ---------------------------------------------------------------- */}
        {/* Energy flow                                                       */}
        {/* ---------------------------------------------------------------- */}

        <EnergyFlow
          intensity={twin.gridNow}
          solarNow={twin.solarNow}
        />

        {/* ---------------------------------------------------------------- */}
        {/* Camera                                                            */}
        {/* ---------------------------------------------------------------- */}

        {P.trees && <Garden />}
        {P.trees && <Clouds />}

        <CameraFocus
          selected={selected}
        />

        <OrbitControls
          makeDefault
          enablePan={false}
          minPolarAngle={0.25}
          maxPolarAngle={
            Math.PI / 2.35
          }
          minDistance={10}
          maxDistance={34}
          target={[0.6, 0.5, 0.2]}
          autoRotate={rotating}
          autoRotateSpeed={2.4}
          enableDamping
          dampingFactor={0.08}
        />

        {/* ---------------------------------------------------------------- */}
        {/* DOM label projection                                              */}
        {/* ---------------------------------------------------------------- */}

        <LabelProjector
          refs={labelRefs}
        />
      </Canvas>
    </div>
  );
}

export const ROOM_LABELS =
  Object.fromEntries(
    ROOMS.map((r) => [
      r.id,
      r.label,
    ])
  ) as Record<
    RoomId,
    string
  >;

