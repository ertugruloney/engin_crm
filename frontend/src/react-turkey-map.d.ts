declare module 'react-turkey-map' {
  import type { CSSProperties } from 'react';

  type TurkeyMapProps = {
    zoomable?: boolean;
    showTooltip?: boolean;
    minZoom?: number;
    maxZoom?: number;
    markers?: Array<Record<string, unknown>>;
    colorData?: Record<string, string>;
    clickableCities?: boolean;
    showCityTooltip?: boolean;
    tooltipData?: Record<string, string>;
    showMarkerTooltip?: boolean;
    onCityClick?: (data: { plate: string | null; city: string | null }, event: MouseEvent) => void;
    onMarkerClick?: (data: Record<string, unknown>, event: MouseEvent) => void;
    style?: CSSProperties;
  };

  const TurkeyMap: (props: TurkeyMapProps) => JSX.Element;
  export default TurkeyMap;
}
