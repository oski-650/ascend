"use client";
import { useState } from "react";
import dynamic from "next/dynamic";

// react-player + react-modal are only needed once the user opens the modal.
const VideoModal = dynamic(() => import("./VideoModal"), { ssr: false });

interface VideoModalButtonProps {
  videoSrc: string;
  buttonClassName?: string;
  iconClassName?: string;
}

export default function VideoModalButton({
  videoSrc,
  buttonClassName = "btn btn-round btn-round-medium btn-accent slide-right anim-no-delay showreel-trigger",
  iconClassName = "ph-fill ph-play",
}: VideoModalButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button onClick={() => setIsOpen(true)} className={buttonClassName}>
        <i className={iconClassName} />
      </button>
      {isOpen && <VideoModal videoSrc={videoSrc} open={isOpen} setOpen={setIsOpen} />}
    </>
  );
}
