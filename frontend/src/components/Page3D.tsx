import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, RoundedBox } from "@react-three/drei";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";

/*
 * Small 3D scenes for the pages (the Overview has the full 3D house in HouseScene.tsx):
 *   Stage            — shared canvas: soft lights, round floor, slow auto-rotation, drag to turn
 *   EnergyClock3D    — Forecast: 24 hourly bars in a ring (peaks orange), or one bar per day for 3 / 7 days
 *   HeatHouse3D      — Heat pump: house glowing in the indoor-temperature colour, outdoor unit with a spinning fan
 *   CostBars3D       — Cost & plan: usual vs plan cost per hour on floor tiles coloured by tariff zone
 *   SolarRoof3D      — Solar: roof filling with panels as the size grows, the sun circling above
 *   ApplianceOrbs3D  — Appliances: one floating sphere per appliance, size = energy; click to filter by room
 */

const reduceMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Card with a 3D canvas: title, hint and the scene. */
export function View3D({ title, hint, height = 360, camera = [0, 6, 11], children }: { title: string; hint: string; height?: number; camera?: [number, number, number]; children: ReactNode }) {
  return (
    <div className="panel overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4 sm:px-5">
        <h2 className="text-base font-semibold">{title}</h2>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </div>
      <div style={{ height, background: "var(--stage)" }} className="mx-3 mb-3 mt-3 overflow-hidden rounded-xl sm:mx-4 sm:mb-4">
        <Canvas dpr={[1, 1.75]} camera={{ position: camera, fov: 40 }} gl={{ antialias: true, alpha: true }}>
          <ambientLight intensity={0.75} />
          <directionalLight position={[6, 10, 6]} intensity={1.2} />
          <directionalLight position={[-6, 4, -4]} intensity={0.35} />
          {children}
          <OrbitControls enablePan={false} enableZoom={false} autoRotate={!reduceMotion} autoRotateSpeed={0.8} minPolarAngle={0.35} maxPolarAngle={1.35} />
        </Canvas>
      </div>
    </div>
  );
}

function Floor({ radius = 6, color = "#dbe4f0" }: { radius?: number; color?: string }) {
  // darker floor in the dark theme (the page re-renders these scenes when the theme changes)
  const dark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  return (
    <mesh rotation-x={-Math.PI / 2} position-y={-0.01}>
      <circleGeometry args={[radius, 64]} />
      <meshStandardMaterial color={dark ? "#2a3950" : color} transparent opacity={0.85} />
    </mesh>
  );
}

/** A bar that grows smoothly to its target height. */
function Bar({ x, z, h, color, w = 0.32, rotY = 0 }: { x: number; z: number; h: number; color: string; w?: number; rotY?: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const next = reduceMotion ? h : THREE.MathUtils.lerp(m.scale.y, h, 0.08);
    m.scale.y = Math.max(0.001, next);
    m.position.y = m.scale.y / 2;
  });
  return (
    <mesh ref={ref} position={[x, 0, z]} rotation-y={rotY} scale={[1, 0.001, 1]}>
      <boxGeometry args={[w, 1, w]} />
      <meshStandardMaterial color={color} roughness={0.45} metalness={0.05} />
    </mesh>
  );
}

/**
 * A text label that follows a point in the scene: a plain DOM element placed over the canvas and moved every
 * frame from the projected position (no extra React root, so it is reliable and cheap).
 */
function Label({ position = [0, 0, 0], text, strong = false }: { position?: [number, number, number]; text: string; strong?: boolean }) {
  const { gl, camera, size } = useThree();
  const anchor = useRef<THREE.Group>(null);
  const el = useMemo(() => document.createElement("span"), []);
  const v = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => {
    Object.assign(el.style, {
      position: "absolute",
      left: "0",
      top: "0",
      pointerEvents: "none",
      whiteSpace: "nowrap",
      font: "500 11px Inter, system-ui, sans-serif",
      color: "#334155",
      background: "rgba(255,255,255,0.88)",
      padding: "2px 6px",
      borderRadius: "6px",
      boxShadow: "0 1px 2px rgba(15,23,42,0.12)",
    });
    const host = gl.domElement.parentElement;
    host?.appendChild(el);
    return () => el.remove();
  }, [el, gl]);
  useEffect(() => {
    el.textContent = text;
    el.style.fontWeight = strong ? "600" : "500";
  }, [el, text, strong]);
  useFrame(() => {
    if (!anchor.current) return;
    anchor.current.getWorldPosition(v);
    v.project(camera);
    el.style.display = v.z > 1 ? "none" : "block";
    el.style.transform = `translate(-50%, -50%) translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px)`;
  });
  return <group ref={anchor} position={position} />;
}

const label = (text: string, pos: [number, number, number], strong = false) => <Label text={text} position={pos} strong={strong} />;

/* ------------------------------------------------------------------ Forecast */

export function EnergyClock3D({ values, peaks, dayLabels }: { values: number[]; peaks: boolean[]; dayLabels?: string[] }) {
  const max = Math.max(...values, 0.01);
  if (dayLabels) {
    // one bar per day, in a row
    const n = values.length;
    return (
      <group>
        <Floor radius={6.2} />
        {values.map((v, i) => {
          const x = (i - (n - 1) / 2) * (n > 4 ? 1.35 : 2.2);
          const top = values.indexOf(max) === i;
          return (
            <group key={i}>
              <Bar x={x} z={0} h={(v / max) * 4} w={0.85} color={top ? "#f97316" : "#3b82f6"} />
              {label(`${dayLabels[i]} · ${v.toFixed(0)} kWh`, [x, (v / max) * 4 + 0.45, 0], top)}
            </group>
          );
        })}
      </group>
    );
  }
  // 24 hours in a ring, like a clock (00:00 at the top)
  const R = 3.6;
  return (
    <group>
      <Floor radius={5.4} />
      <mesh rotation-x={-Math.PI / 2} position-y={0.005}>
        <ringGeometry args={[R - 0.45, R + 0.45, 64]} />
        <meshStandardMaterial color="#c7d4e8" />
      </mesh>
      {values.map((v, i) => {
        const a = (i / 24) * Math.PI * 2;
        const x = Math.sin(a) * R;
        const z = -Math.cos(a) * R;
        return <Bar key={i} x={x} z={z} h={0.15 + (v / max) * 3.2} rotY={-a} color={peaks[i] ? "#f97316" : "#3b82f6"} />;
      })}
      {[0, 6, 12, 18].map((hr) => {
        const a = (hr / 24) * Math.PI * 2;
        return <group key={hr}>{label(`${String(hr).padStart(2, "0")}:00`, [Math.sin(a) * (R + 1.05), 0.2, -Math.cos(a) * (R + 1.05)])}</group>;
      })}
      {label(`${values.reduce((s, v) => s + v, 0).toFixed(1)} kWh`, [0, 0.6, 0], true)}
    </group>
  );
}

/* ------------------------------------------------------------------ Heat pump */

function Fan({ speed }: { speed: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (ref.current && !reduceMotion) ref.current.rotation.z += dt * speed * 12;
  });
  return (
    <group ref={ref}>
      {[0, 1, 2].map((i) => (
        <mesh key={i} rotation-z={(i * Math.PI * 2) / 3} position={[0, 0, 0]}>
          <boxGeometry args={[0.12, 0.62, 0.03]} />
          <meshStandardMaterial color="#64748b" />
        </mesh>
      ))}
    </group>
  );
}

/** Warm particles rising inside the house while it heats. */
function HeatWaves({ on }: { on: boolean }) {
  const refs = useRef<THREE.Mesh[]>([]);
  const seeds = useMemo(() => Array.from({ length: 14 }, (_, i) => ({ x: ((i * 37) % 30) / 10 - 1.5, z: ((i * 53) % 20) / 10 - 1, p: (i * 0.13) % 1 })), []);
  useFrame(({ clock }) => {
    refs.current.forEach((m, i) => {
      if (!m) return;
      const t = (clock.elapsedTime * 0.35 + seeds[i].p) % 1;
      m.position.y = 0.3 + t * 2.2;
      (m.material as THREE.MeshStandardMaterial).opacity = on ? Math.sin(t * Math.PI) * 0.8 : 0;
    });
  });
  return (
    <group>
      {seeds.map((s, i) => (
        <mesh key={i} ref={(m) => { if (m) refs.current[i] = m; }} position={[s.x, 0.3, s.z]}>
          <sphereGeometry args={[0.09, 12, 12]} />
          <meshStandardMaterial color="#fb923c" emissive="#f97316" emissiveIntensity={0.8} transparent opacity={0} />
        </mesh>
      ))}
    </group>
  );
}

export function HeatHouse3D({ indoorColor, heatLevel, resting, indoor }: { indoorColor: string; heatLevel: number; resting: boolean; indoor: number }) {
  const heating = heatLevel > 0.02;
  return (
    <group>
      <Floor radius={6} color="#d9e6d3" />
      {/* house: translucent walls with a glowing interior */}
      <mesh position={[0.6, 1.3, 0]}>
        <boxGeometry args={[4.2, 2.6, 3]} />
        <meshStandardMaterial color={indoorColor} emissive={indoorColor} emissiveIntensity={0.35} transparent opacity={0.55} />
      </mesh>
      <mesh position={[0.6, 1.3, 0]}>
        <boxGeometry args={[4.26, 2.66, 3.06]} />
        <meshStandardMaterial color="#ffffff" wireframe />
      </mesh>
      <mesh position={[0.6, 3.25, 0]} rotation-y={Math.PI / 4}>
        <coneGeometry args={[3.35, 1.3, 4]} />
        <meshStandardMaterial color="#334155" />
      </mesh>
      <group position={[0.6, 0, 0]}>
        <HeatWaves on={heating} />
      </group>
      {/* outdoor unit */}
      <group position={[-2.6, 0.55, 1.1]}>
        <RoundedBox args={[1.3, 1.1, 0.6]} radius={0.08}>
          <meshStandardMaterial color="#f8fafc" />
        </RoundedBox>
        <mesh position={[0, 0, 0.31]}>
          <circleGeometry args={[0.38, 32]} />
          <meshStandardMaterial color="#cbd5e1" />
        </mesh>
        <group position={[0, 0, 0.33]}>
          <Fan speed={heating ? 0.3 + heatLevel : 0} />
        </group>
      </group>
      {/* pipe */}
      <mesh position={[-1.75, 0.35, 1.1]} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.07, 0.07, 0.6, 12]} />
        <meshStandardMaterial color={heating ? "#f97316" : "#94a3b8"} emissive={heating ? "#f97316" : "#000000"} emissiveIntensity={heating ? 0.6 : 0} />
      </mesh>
      {label(`${indoor.toFixed(1)} °C inside${resting ? " · resting" : heating ? " · heating" : ""}`, [0.6, 4.1, 0], true)}
    </group>
  );
}

/* ------------------------------------------------------------------ Cost */

export function CostBars3D({ usual, plan, zoneColors }: { usual: number[]; plan: number[]; zoneColors: string[] }) {
  const max = Math.max(...usual, ...plan, 0.01);
  const n = usual.length;
  const at = (i: number, r: number): [number, number] => {
    const a = (i / n) * Math.PI * 2;
    return [Math.sin(a) * r, -Math.cos(a) * r];
  };
  return (
    <group>
      <Floor radius={5.6} />
      {/* tariff zone of every hour as a ring segment (00:00 at the top, clockwise) */}
      {zoneColors.map((c, i) => (
        <mesh key={i} rotation-x={-Math.PI / 2} position-y={0.006}>
          <ringGeometry args={[2.7, 4.35, 8, 1, Math.PI / 2 - ((i + 1) / n) * Math.PI * 2, (Math.PI * 2) / n]} />
          <meshStandardMaterial color={c} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {usual.map((v, i) => {
        const [x, z] = at(i + 0.5, 3.95);
        return <Bar key={`u${i}`} x={x} z={z} h={0.05 + (v / max) * 3.2} w={0.26} rotY={-((i + 0.5) / n) * Math.PI * 2} color="#94a3b8" />;
      })}
      {plan.map((v, i) => {
        const [x, z] = at(i + 0.5, 3.15);
        return <Bar key={`p${i}`} x={x} z={z} h={0.05 + (v / max) * 3.2} w={0.26} rotY={-((i + 0.5) / n) * Math.PI * 2} color="#2563eb" />;
      })}
      {[0, 6, 12, 17].map((hr) => {
        const [x, z] = at(hr, 5.0);
        return <group key={hr}>{label(`${String(hr).padStart(2, "0")}:00`, [x, 0.2, z])}</group>;
      })}
      {label("outer grey = usual · inner blue = plan", [0, 0.6, 0], true)}
    </group>
  );
}

/* ------------------------------------------------------------------ Solar */

function Sun() {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!ref.current || reduceMotion) return;
    const t = clock.elapsedTime * 0.25;
    ref.current.position.set(Math.cos(t) * 4.5, 4.6 + Math.sin(t) * 0.6, Math.sin(t) * 2.5 - 1);
  });
  return (
    <group ref={ref} position={[3.5, 4.8, -1]}>
      <mesh>
        <sphereGeometry args={[0.55, 32, 32]} />
        <meshStandardMaterial color="#fcd34d" emissive="#f59e0b" emissiveIntensity={1.2} />
      </mesh>
      <pointLight intensity={8} distance={14} color="#fde68a" />
    </group>
  );
}

export function SolarRoof3D({ kwp, maxKwp }: { kwp: number; maxKwp: number }) {
  const cols = 6;
  const rows = 3;
  const shown = kwp > 0 ? Math.max(1, Math.round((kwp / maxKwp) * cols * rows)) : 0;
  // one roof plane facing south (+z), tilted
  const tilt = 0.6;
  return (
    <group>
      <Floor radius={6} color="#d9e6d3" />
      <mesh position={[0, 1.2, 0]}>
        <boxGeometry args={[4.4, 2.4, 3.2]} />
        <meshStandardMaterial color="#f8fafc" />
      </mesh>
      <mesh position={[0, 0.8, 1.61]}>
        <planeGeometry args={[0.7, 1.4]} />
        <meshStandardMaterial color="#0284c7" />
      </mesh>
      {/* roof */}
      <group position={[0, 2.4, 0]}>
        <mesh position={[0, 0.62, 0.8]} rotation-x={tilt}>
          <boxGeometry args={[4.8, 0.1, 2.05]} />
          <meshStandardMaterial color="#334155" />
        </mesh>
        <mesh position={[0, 0.62, -0.8]} rotation-x={-tilt}>
          <boxGeometry args={[4.8, 0.1, 2.05]} />
          <meshStandardMaterial color="#475569" />
        </mesh>
        {/* panels on the south side */}
        <group position={[0, 0.62, 0.8]} rotation-x={tilt}>
          {Array.from({ length: cols * rows }, (_, i) => {
            const c = i % cols;
            const r = Math.floor(i / cols);
            const on = i < shown;
            return (
              <mesh key={i} position={[(c - (cols - 1) / 2) * 0.74, 0.08, (r - (rows - 1) / 2) * 0.6]}>
                <boxGeometry args={[0.66, 0.04, 0.52]} />
                <meshStandardMaterial color={on ? "#1d4ed8" : "#64748b"} emissive={on ? "#38bdf8" : "#000000"} emissiveIntensity={on ? 0.25 : 0} transparent opacity={on ? 1 : 0.25} />
              </mesh>
            );
          })}
        </group>
      </group>
      <Sun />
      {label(`${kwp.toFixed(1)} kWp · ${Math.round(kwp / 0.42)} panels`, [0, 3.9, 0], true)}
    </group>
  );
}

/* ------------------------------------------------------------------ Appliances */

function Orb({ pos, r, color, dim, onClick, name, below }: { pos: [number, number, number]; r: number; color: string; dim: boolean; onClick: () => void; name: string; below: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  const phase = useMemo(() => Math.random() * Math.PI * 2, []);
  useFrame(({ clock }) => {
    if (ref.current && !reduceMotion) ref.current.position.y = pos[1] + Math.sin(clock.elapsedTime * 1.2 + phase) * 0.15;
  });
  return (
    <mesh
      ref={ref}
      position={pos}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onPointerOver={() => (document.body.style.cursor = "pointer")}
      onPointerOut={() => (document.body.style.cursor = "")}
    >
      <sphereGeometry args={[r, 40, 40]} />
      <meshStandardMaterial color={color} roughness={0.35} metalness={0.1} transparent opacity={dim ? 0.3 : 0.95} />
      <Label position={[0, below ? -r - 0.28 : r + 0.28, 0]} text={name} strong />
    </mesh>
  );
}

export function ApplianceOrbs3D({
  items,
  selectedRoom,
  onPick,
}: {
  items: { id: string; name: string; kwh: number; color: string; room: string }[];
  selectedRoom: string | null;
  onPick: (room: string) => void;
}) {
  const max = Math.max(...items.map((a) => a.kwh), 0.01);
  // golden-angle spiral so the orbs spread evenly and never overlap
  return (
    <group>
      <Floor radius={7} />
      {items.map((a, i) => {
        const angle = i * 2.4;
        const dist = i === 0 ? 0 : 2.2 + Math.sqrt(i) * 1.3;
        const r = 0.22 + Math.sqrt(a.kwh / max) * 0.85;
        return (
          <Orb
            key={a.id}
            pos={[Math.cos(angle) * dist, r + 0.3, Math.sin(angle) * dist]}
            r={r}
            color={a.color}
            name={`${a.name} ${a.kwh.toFixed(1)} kWh`}
            dim={!!selectedRoom && selectedRoom !== a.room}
            below={i % 2 === 1}
            onClick={() => onPick(a.room)}
          />
        );
      })}
    </group>
  );
}
