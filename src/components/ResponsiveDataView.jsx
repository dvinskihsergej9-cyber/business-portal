import useIsMobile from "../hooks/useIsMobile";

export default function ResponsiveDataView({ isMobile, cards, table }) {
  const resolvedIsMobile = isMobile ?? useIsMobile();

  if (resolvedIsMobile) {
    return cards || null;
  }

  return table || null;
}
