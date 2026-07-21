import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ControlPanel from "./ControlPanel";
import { commands } from "./driveCommands";
import socket from "../socket";

vi.mock("../socket", () => ({
  default: {
    emit: vi.fn(),
  },
}));

describe("ControlPanel", () => {
  afterEach(() => {
    socket.emit.mockClear();
  });

  it("renders all manual drive commands", () => {
    render(<ControlPanel activeCommand="BRAKE" />);

    for (const command of commands) {
      expect(screen.getByRole("button", { name: command.label })).toBeInTheDocument();
    }

    expect(screen.getByRole("button", { name: "Brake" })).toHaveClass("active");
  });

  it("emits selected commands", async () => {
    render(<ControlPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Left" }));

    expect(socket.emit).toHaveBeenCalledWith("control_command", "LEFT");
  });
});
