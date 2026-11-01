import { describe, expect, it } from "vitest";
import { Container, RendererType } from "pixi.js";
import { clearLayers, createLayers, rendererKind } from "../src/client/game/app";

describe("rendererKind", () => {
  it("maps pixi renderer types", () => {
    expect(rendererKind(RendererType.WEBGPU, "webgpu")).toBe("webgpu");
    expect(rendererKind(RendererType.WEBGL, "webgl")).toBe("webgl");
    expect(rendererKind(undefined, "WebGPU")).toBe("webgpu");
    expect(rendererKind(RendererType.CANVAS, "canvas")).toBe("webgl");
  });
});

describe("layers", () => {
  it("nests world layers in draw order with sorted y-sortable", () => {
    const l = createLayers();
    expect(l.world.children).toEqual([l.ground, l.groundOverlay, l.sorted]);
    expect(l.sorted.sortableChildren).toBe(true);
    expect(l.screen.parent).toBeNull();
    expect(l.overlay.parent).toBeNull(); // stage child above `screen`, moved by the camera
  });

  it("clearLayers destroys children but keeps layers", () => {
    const l = createLayers();
    const kids = [l.ground, l.groundOverlay, l.sorted, l.overlay].map((c) => c.addChild(new Container()));
    const screenKid = l.screen.addChild(new Container());
    clearLayers(l);
    for (const k of kids) expect(k.destroyed).toBe(true);
    expect(l.sorted.children.length).toBe(0);
    expect(l.sorted.destroyed).toBe(false);
    expect(l.world.children.length).toBe(3);
    expect(screenKid.destroyed).toBe(false);
  });
});
