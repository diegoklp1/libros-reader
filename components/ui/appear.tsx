// Entrada de un elemento: aparece subiendo (o bajando) una distancia corta.
//
// Usa la API `Animated` de React Native y no las animaciones de layout de
// Reanimated (`entering={FadeInDown…}`). Esas dejan el elemento en
// `visibility: hidden` hasta que la animación arranca, y en el build web de
// este proyecto no llega a arrancar nunca: la pantalla queda en blanco. La API
// de React Native se comporta igual en Android y en el navegador.

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleProp, ViewStyle } from 'react-native';
import { motion, USE_NATIVE_DRIVER } from '../../src/theme';

interface Props {
  /** Opcional: una barra de gráfico o una celda de mapa entra sin contenido propio. */
  children?: React.ReactNode;
  /** Milisegundos de espera antes de entrar. Sirve para escalonar una lista. */
  delay?: number;
  duration?: number;
  /** Píxeles que recorre. Negativo entra desde arriba. */
  distance?: number;
  style?: StyleProp<ViewStyle>;
}

export const Appear: React.FC<Props> = ({
  children,
  delay = 0,
  duration = motion.slow,
  distance = 14,
  style,
}) => {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: USE_NATIVE_DRIVER,
    });
    animation.start();
    return () => animation.stop();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
};
