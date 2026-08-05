// Barra de progreso que viaja hasta su nuevo valor en lugar de saltar.
// Al volver de leer, ver la barra avanzar es la confirmación de que el
// progreso quedó guardado.

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleProp, View, ViewStyle } from 'react-native';
import { motion } from '../../src/theme';

interface Props {
  /** Entre 0 y 1. */
  value: number;
  color: string;
  trackColor: string;
  height?: number;
  style?: StyleProp<ViewStyle>;
  /** Sin animación para la primera pintada de una lista larga. */
  animated?: boolean;
}

export const ProgressBar: React.FC<Props> = ({
  value,
  color,
  trackColor,
  height = 4,
  style,
  animated = true,
}) => {
  const clamped = Math.max(0, Math.min(1, isFinite(value) ? value : 0));
  const progress = useRef(new Animated.Value(animated ? 0 : clamped)).current;

  useEffect(() => {
    if (!animated) {
      progress.setValue(clamped);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: clamped,
      duration: motion.slow,
      easing: Easing.out(Easing.cubic),
      // El ancho es una propiedad de layout: el driver nativo no la maneja.
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [clamped, animated]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={[
        { height, borderRadius: height / 2, backgroundColor: trackColor, overflow: 'hidden' },
        style,
      ]}
    >
      <Animated.View
        style={{
          height: '100%',
          borderRadius: height / 2,
          backgroundColor: color,
          width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
        }}
      />
    </View>
  );
};
