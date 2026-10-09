'use client';
// Turns a screen component (written like the app's screens: props { navigation, route }) into a page.
import React from 'react';
import { Screen, useNav, useRouteParams } from './nav';

export type ScreenProps<P = any> = {
  navigation: ReturnType<typeof useNav>;
  route: { name: Screen; params: P };
};

export function screenPage<P = any>(screen: Screen, Component: React.ComponentType<ScreenProps<P>>, extraParams?: (stored: P | undefined) => Partial<P>) {
  return function Page() {
    const navigation = useNav();
    const { params, key, ready } = useRouteParams<P>(screen);
    // extraParams may use hooks (e.g. useParams for a code in the URL), so it runs on every render
    const extra = extraParams ? extraParams(params) : {};
    if (!ready) return null; // params live in sessionStorage, read after mount
    const merged = { ...(params || {}), ...extra } as P;
    return <Component key={key} navigation={navigation} route={{ name: screen, params: merged }} />;
  };
}
