import { useEffect, useState } from "react";

export default function useIsMobile(maxWidth = 768) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(`(max-width: ${maxWidth}px)`);
    const handleChange = (event) => setIsMobile(event.matches);
    setIsMobile(media.matches);

    if (media.addEventListener) {
      media.addEventListener("change", handleChange);
    } else {
      media.addListener(handleChange);
    }

    return () => {
      if (media.removeEventListener) {
        media.removeEventListener("change", handleChange);
      } else {
        media.removeListener(handleChange);
      }
    };
  }, [maxWidth]);

  return isMobile;
}
