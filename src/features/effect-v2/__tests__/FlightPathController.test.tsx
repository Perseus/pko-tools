import { describe, expect, it } from "vitest";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import { act } from "react";
import * as THREE from "three";
import { TimeProvider, TimeSource } from "../TimeContext";
import { FlightPathController } from "../renderers/flight/FlightPathController";
import { magicEntryFixture } from "./fixtures";

const testTimeSource: TimeSource = {
  getTime: () => 0.7,
  playing: true,
  loop: true,
};

describe("FlightPathController", () => {
  it("renders the current C++ magic position before advancing the path for the next frame", async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <TimeProvider value={testTimeSource}>
        <FlightPathController
          magicEntry={{ ...magicEntryFixture, render_idx: 1, velocity: 10 }}
          origin={new THREE.Vector3(0, 0, 0)}
          target={new THREE.Vector3(0, 8, 0)}
          awaitingHitEffect={false}
          hasHitEffect={false}
        >
          <mesh name="flight-child">
            <boxGeometry />
            <meshBasicMaterial />
          </mesh>
        </FlightPathController>
      </TimeProvider>,
    );

    const flightGroup = renderer.scene.findByProps({ name: "flight-child" }).instance.parent as THREE.Group;

    await act(async () => {
      await renderer.advanceFrames(1, 0.1);
    });

    expect(flightGroup.position.toArray()).toEqual([0, 0, 0]);

    await act(async () => {
      await renderer.advanceFrames(1, 0.1);
    });

    expect(flightGroup.position.x).toBeCloseTo(0);
    expect(flightGroup.position.y).toBeCloseTo(1);
    expect(flightGroup.position.z).toBeCloseTo(0);
  });

  it("renders fshade afterimage samples from dedicated trail children only", async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <TimeProvider value={testTimeSource}>
        <FlightPathController
          magicEntry={{ ...magicEntryFixture, render_idx: 3, velocity: 10 }}
          origin={new THREE.Vector3(0, 0, 0)}
          target={new THREE.Vector3(0, 8, 0)}
          awaitingHitEffect={false}
          hasHitEffect={false}
          trailChildren={
            <mesh name="trail-child">
              <boxGeometry />
              <meshBasicMaterial />
            </mesh>
          }
        >
          <mesh name="main-child">
            <boxGeometry />
            <meshBasicMaterial />
          </mesh>
        </FlightPathController>
      </TimeProvider>,
    );

    await act(async () => {
      await renderer.advanceFrames(1, 1 / 60);
    });

    expect(renderer.scene.findAllByProps({ name: "main-child" }).length).toBe(1);
    expect(renderer.scene.findAllByProps({ name: "trail-child" }).length).toBeGreaterThan(0);
  });
});
