// Panel que sube desde el borde inferior y se cierra arrastrándolo hacia abajo.
//
// Dos decisiones que no son obvias:
//
// 1. El Modal nativo no sirve solo: al pasar `visible` a false desmonta el
//    contenido de inmediato y la animación de salida nunca llega a verse. Por
//    eso el montaje se controla acá: se anima primero y se desmonta después.
//
// 2. El gesto va con PanResponder (React Native) y no con gesture-handler +
//    Reanimated, para que el panel se comporte igual en Android y en web.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { motion, shadow, Theme, USE_NATIVE_DRIVER } from '../../src/theme';

interface Props {
  visible: boolean;
  onClose: () => void;
  theme: Theme;
  children: React.ReactNode;
  /** Color de fondo del panel; por defecto la superficie del tema. */
  background?: string;
  /** Color del tirador. Útil cuando el panel usa el tema del lector. */
  handleColor?: string;
  maxWidth?: number;
  /**
   * Arrastrar el panel para cerrarlo. Se apaga cuando adentro hay una lista
   * que se desplaza: los dos gestos compiten y gana el equivocado.
   */
  draggable?: boolean;
}

export const Sheet: React.FC<Props> = ({
  visible,
  onClose,
  theme,
  children,
  background,
  handleColor,
  maxWidth = 640,
  draggable = true,
}) => {
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const sheetHeight = useRef(420);

  // 0 = fuera de pantalla, 1 = arriba del todo.
  const progress = useRef(new Animated.Value(0)).current;
  const dragY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: 0,
      duration: motion.normal,
      useNativeDriver: USE_NATIVE_DRIVER,
    });
    animation.start(({ finished }) => { if (finished) setMounted(false); });
    return () => animation.stop();
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!mounted || !visible) return;
    dragY.setValue(0);
    const animation = Animated.spring(progress, {
      toValue: 1,
      damping: motion.slide.damping,
      stiffness: motion.slide.stiffness,
      mass: motion.slide.mass,
      useNativeDriver: USE_NATIVE_DRIVER,
    });
    animation.start();
    return () => animation.stop();
  }, [mounted, visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        // Solo se toma el gesto si es claramente vertical y hacia abajo: así un
        // toque sobre un botón del panel sigue siendo un toque.
        onMoveShouldSetPanResponder: (_, g) =>
          draggable && g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderMove: (_, g) => {
          dragY.setValue(Math.max(0, g.dy));
        },
        onPanResponderRelease: (_, g) => {
          const farEnough = g.dy > sheetHeight.current * 0.3;
          const fastEnough = g.vy > 0.8;
          if (farEnough || fastEnough) {
            onClose();
          } else {
            Animated.spring(dragY, {
              toValue: 0,
              damping: motion.slide.damping,
              stiffness: motion.slide.stiffness,
              mass: motion.slide.mass,
              useNativeDriver: USE_NATIVE_DRIVER,
            }).start();
          }
        },
      }),
    [draggable, onClose, dragY]
  );

  if (!mounted) return null;

  // Se desplaza hacia abajo lo que falte para estar arriba, más lo arrastrado.
  const translateY = Animated.add(
    progress.interpolate({ inputRange: [0, 1], outputRange: [800, 0] }),
    dragY
  );

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlay, opacity: progress }]}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Cerrar" />
        </Animated.View>

        <Animated.View
          {...panResponder.panHandlers}
          onLayout={(e) => { sheetHeight.current = e.nativeEvent.layout.height; }}
          style={[
            styles.panel,
            {
              backgroundColor: background ?? theme.colors.surface,
              borderTopLeftRadius: theme.radius.xl,
              borderTopRightRadius: theme.radius.xl,
              paddingBottom: Math.max(insets.bottom, 16) + 8,
              maxWidth,
              transform: [{ translateY }],
            },
            shadow(12, 'up'),
          ]}
        >
          {/* El tirador se muestra siempre: es lo que identifica al panel como
              algo que se cierra, se pueda arrastrar o no. */}
          <View style={[styles.handle, { backgroundColor: handleColor ?? theme.colors.border }]} />
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  panel: {
    width: '100%',
    alignSelf: 'center',
    paddingTop: 8,
    paddingHorizontal: 20,
    // En web el panel no debe pasar del alto de la ventana.
    ...(Platform.OS === 'web' ? { maxHeight: '90vh' as any } : { maxHeight: '92%' }),
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 14,
  },
});
