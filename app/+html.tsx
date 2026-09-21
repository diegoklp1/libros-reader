import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="es">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <meta name="theme-color" content="#7A5C3E" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="LectorLibros" />
        <meta
          name="description"
          content="Tu biblioteca, lectura y audiolibros sincronizados entre PC y celular."
        />
        <link rel="manifest" href="/libros-reader-web/manifest.webmanifest" />
        <link rel="apple-touch-icon" href="/libros-reader-web/icon-192.png" />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: responsiveBackground }} />
        <script dangerouslySetInnerHTML={{ __html: serviceWorkerRegistration }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

const responsiveBackground = `
body { background-color: #F5F1E8; }
@media (prefers-color-scheme: dark) { body { background-color: #171512; } }
`;

const serviceWorkerRegistration = `
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/libros-reader-web/sw.js', { scope: '/libros-reader-web/' })
      .catch(function (error) { console.error('No se pudo habilitar el modo offline', error); });
  });
}
`;
