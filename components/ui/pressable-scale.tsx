// Botón que responde al dedo encogiéndose. Es el ladrillo de casi toda la
// interacción de la app: reemplaza a TouchableOpacity, que solo baja la
// opacidad y en pantallas claras casi no se nota.

import React, { useCallback, useRef } from 'react';
import { Animated, Pressable, PressableProps, StyleProp, ViewStyle } from 'react-native';
import { longPressFeedback, tapFeedback } from '../../src/haptics';
import { motion, USE_NATIVE_DRIVER } from '../../src/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface PressableScaleProps extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
  /** Cuánto se encoge al presionar. Los objetos grandes necesitan menos. */
  scaleTo?: number;
  /** Opacidad mientras está presionado; 1 deja solo la escala. */
  dimTo?: number;
  /** Vibración corta al soltar. Desactivalo en listas muy largas. */
  haptic?: boolean;
  children?: React.ReactNode;
}

export const PressableScale: React.FC<PressableScaleProps> = ({
  style,
  scaleTo = 0.97,
  dimTo = 1,
  haptic = false,
  onPress,
  onLongPress,
  onPressIn,
  onPressOut,
  children,
  ...rest
}) => {
  const pressed = useRef(new Animated.Value(0)).current;

  const animate = useCallback(
    (toValue: number) => {
      Animated.spring(pressed, {
        toValue,
        damping: motion.press.damping,
        stiffness: motion.press.stiffness,
        mass: motion.press.mass,
        useNativeDriver: USE_NATIVE_DRIVER,
      }).start();
    },
    [pressed]
  );

  const handlePressIn: PressableProps['onPressIn'] = useCallback(
    (e: any) => { animate(1); onPressIn?.(e); },
    [animate, onPressIn]
  );

  const handlePressOut: PressableProps['onPressOut'] = useCallback(
    (e: any) => { animate(0); onPressOut?.(e); },
    [animate, onPressOut]
  );

  const handlePress: PressableProps['onPress'] = useCallback(
    (e: any) => {
      if (haptic) tapFeedback();
      onPress?.(e);
    },
    [haptic, onPress]
  );

  const handleLongPress: PressableProps['onLongPress'] = useCallback(
    (e: any) => {
      longPressFeedback();
      onLongPress?.(e);
    },
    [onLongPress]
  );

  return (
    <AnimatedPressable
      {...rest}
      style={[
        style,
        {
          transform: [{ scale: pressed.interpolate({ inputRange: [0, 1], outputRange: [1, scaleTo] }) }],
          opacity: pressed.interpolate({ inputRange: [0, 1], outputRange: [1, dimTo] }),
        },
      ]}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
      onLongPress={onLongPress ? handleLongPress : undefined}
    >
      {children}
    </AnimatedPressable>
  );
};
