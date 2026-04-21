import { 
  Flame, 
  Gift, 
  Zap, 
  FlaskConical, 
  Gamepad2,
  Package
} from 'lucide-react';

// Map emoji strings to Lucide React icons
export const getCategoryIcon = (iconString: string) => {
  const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
    '🔥': Flame,
    '🎁': Gift,
    '⚡': Zap,
    '🧪': FlaskConical,
    '🎮': Gamepad2,
    '📦': Package,
    'default': Package
  };

  return iconMap[iconString] || iconMap['default'];
};

// Map emoji strings to icon component for rendering
export const renderCategoryIcon = (iconString: string, className: string = 'w-12 h-12') => {
  const IconComponent = getCategoryIcon(iconString);
  return <IconComponent className={className} />;
};
