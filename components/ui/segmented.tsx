// Selector de opciones con un indicador que se desliza hasta la elegida.
// El deslizamiento importa: dice de dónde a dónde fuiste, cosa que un cambio
// de color instantáneo no comunica.

import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, LayoutChangeEvent, StyleProp, Text, View, ViewStyle } from 'react-native';
import { selectFeedback } from '../../src/haptics';
import { motion, shadow, Theme, USE_NATIVE_DRIVER } from '../../src/theme';
import { PressableScale } from './pressable-scale';

const RAIL_PADDING = 4;

export interface SegmentedOption<T extends string> {
  key: T;
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
}

interface Props<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  theme: Theme;
  /** `solid` pinta el indicador con el color primario; `subtle`, con la superficie. */
  variant?: 'solid' | 'subtle';
  style?: StyleProp<ViewStyle>;
  /** Oculta las etiquetas y deja solo los íconos (útil en pantallas angostas). */
  iconOnly?: boolean;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  theme,
  variant = 'subtle',
  style,
  iconOnly = false,
}: Props<T>) {
  const [trackWidth, setTrackWidth] = useState(0);
  const index = Math.max(0, options.findIndex((o) => o.key === value));
  // El riel tiene 4px de padding a cada lado: el ancho útil es el interior.
  const segmentWidth = trackWidth > 0 ? (trackWidth - RAIL_PADDING * 2) / options.length : 0;

  const offset = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const target = index * segmentWidth;
    // Antes de la primera medición no hay a dónde deslizarse: se coloca directo.
    if (segmentWidth === 0) {
      offset.setValue(target);
      return;
    }
    const animation = Animated.spring(offset, {
      toValue: target,
      damping: motion.slide.damping,
      stiffness: motion.slide.stiffness,
      mass: motion.slide.mass,
      useNativeDriver: USE_NATIVE_DRIVER,
    });
    animation.start();
    return () => animation.stop();
  }, [index, segmentWidth]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeColor = variant === 'solid' ? theme.colors.onPrimary : theme.colors.text;

  return (
    <View
      onLayout={(e: LayoutChangeEvent) => setTrackWidth(e.nativeEvent.layout.width)}
      style={[
        {
          flexDirection: 'row',
          backgroundColor: theme.colors.surfaceAlt,
          borderRadius: theme.radius.sm + 2,
          padding: RAIL_PADDING,
        },
        style,
      ]}
    >
      {segmentWidth > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: RAIL_PADDING,
              bottom: RAIL_PADDING,
              left: RAIL_PADDING,
              width: segmentWidth,
              borderRadius: theme.radius.sm,
              backgroundColor: variant === 'solid' ? theme.colors.primary : theme.colors.surface,
              transform: [{ translateX: offset }],
            },
            variant === 'subtle' ? shadow(1) : null,
          ]}
        />
      )}

      {options.map((option) => {
        const active = option.key === value;
        return (
          <PressableScale
            key={option.key}
            scaleTo={0.94}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={option.label}
            onPress={() => {
              if (active) return;
              selectFeedback();
              onChange(option.key);
            }}
            style={{
              flex: 1,
              flexDirection: 'row',
              gap: 6,
              alignItems: 'center',
              justifyContent: 'center',
              paddingVertical: 9,
            }}
          >
            {option.icon && (
              <Ionicons
                name={option.icon}
                size={17}
                color={active ? activeColor : theme.colors.textSecondary}
              />
            )}
            {!iconOnly && (
              <Text
                numberOfLines={1}
                style={{
                  fontFamily: active ? theme.fonts.bold : theme.fonts.semibold,
                  fontSize: 13,
                  color: active ? activeColor : theme.colors.textSecondary,
                }}
              >
                {option.label}
              </Text>
            )}
          </PressableScale>
        );
      })}
    </View>
  );
}
