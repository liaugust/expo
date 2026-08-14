import { expect, jest, test } from '@jest/globals';
import { render, type RenderAPI } from '@testing-library/react-native';

import type { RouteNode } from '../../Route';
import { routingQueue } from '../../global-state/routingQueue';
import { storeRef as mockStoreRef } from '../../global-state/store';
import { createNavigationContainerRef, type ParamListBase } from '../../react-navigation/core';
import { NavigationContainer } from '../NavigationContainer';
import { useLinking } from '../useLinking';

let errorSpy: jest.SpiedFunction<typeof console.error> | undefined;
let mockRouteNode: RouteNode;

jest.mock('../../global-state/storeContext', () => ({
  useExpoRouterStore: () => ({
    get state() {
      return mockStoreRef.current.state;
    },
    get routeNode() {
      return mockRouteNode;
    },
  }),
}));

function node(route: string, children: RouteNode[] = []): RouteNode {
  return {
    type: 'route',
    route,
    children,
    dynamic: null,
    contextKey: route,
    loadRoute: () => ({}),
  };
}

beforeEach(() => {
  routingQueue.queue = [];
  mockRouteNode = node('root', [node('home', [node('[id]')])]);
  mockStoreRef.current.state = undefined;
  mockStoreRef.current.routeInfo = undefined;
});

afterEach(() => {
  errorSpy?.mockRestore();
});

test('queues an incoming deep link using its extracted app path', () => {
  const ref = createNavigationContainerRef<ParamListBase>();
  ref.current = {
    getRootState: () => ({ routeNames: ['home'] }),
  } as typeof ref.current;
  let listener: ((url: string) => void) | undefined;
  const getStateFromPath = jest.fn(() => ({ routes: [{ name: 'home' }] }));

  function Sample() {
    useLinking(
      ref,
      {
        prefixes: ['example://'],
        getStateFromPath,
        subscribe: (nextListener) => {
          listener = nextListener;
          return () => {};
        },
      },
      () => {}
    );
    return null;
  }

  render(<Sample />);
  listener?.('example://home?from=link');

  expect(getStateFromPath).toHaveBeenCalledWith('home?from=link', undefined);
  expect(routingQueue.queue).toEqual([
    {
      type: 'NAVIGATE_TO_HREF',
      payload: {
        href: '/home?from=link',
        originalHref: 'example://home?from=link',
        options: { event: 'NAVIGATE' },
      },
    },
  ]);
});

test('resolves a completed state from an async initial URL without writing to the store', async () => {
  const ref = createNavigationContainerRef<ParamListBase>();
  let getInitialState: ReturnType<typeof useLinking>['getInitialState'] | undefined;
  const getStateFromPath = jest.fn(() => ({
    routes: [
      {
        name: '__root',
        state: {
          routes: [
            {
              name: 'home',
              state: { routes: [{ name: '[id]', path: '/home/42', params: { id: '42' } }] },
            },
          ],
        },
      },
    ],
  }));

  function Sample() {
    getInitialState = useLinking(
      ref,
      {
        prefixes: ['example://'],
        getInitialURL: () => Promise.resolve('example://home/42'),
        getStateFromPath,
      },
      () => {}
    ).getInitialState;
    return null;
  }

  render(<Sample />);
  const state = await getInitialState?.();

  expect(getStateFromPath).toHaveBeenCalledWith('/home/42', undefined);
  expect(state?.routes[0]!.state?.routes[0]!.state).toMatchObject({
    stale: false,
    key: expect.any(String),
    routeNames: ['[id]'],
  });
  expect(mockStoreRef.current.state).toBeUndefined();
  expect(mockStoreRef.current.routeInfo).toBeUndefined();
});

test('seeds the store when a synchronous initial URL is absent', () => {
  render(
    <NavigationContainer
      documentTitle={{ enabled: false }}
      linking={{ prefixes: [], getInitialURL: () => null }}>
      {null}
    </NavigationContainer>
  );

  expect(mockStoreRef.current.state).toMatchObject({
    stale: false,
    routeNames: ['__root', '+not-found', '_sitemap'],
    routes: [{ name: '__root' }],
  });
  expect(mockStoreRef.current.routeInfo?.pathname).toBe('/');
});

test('throws if multiple instances of useLinking are used', () => {
  const ref = createNavigationContainerRef<ParamListBase>();

  const options = { prefixes: [] };

  function Sample() {
    useLinking(ref, options, () => {});
    useLinking(ref, options, () => {});
    return null;
  }

  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

  let element: RenderAPI | undefined;

  element = render(<Sample />);

  expect(errorSpy).toHaveBeenCalledTimes(1);
  expect(errorSpy.mock.calls[0]![0]).toMatch(
    'Looks like you have configured linking in multiple places.'
  );

  element?.unmount();

  function A() {
    useLinking(ref, options, () => {});
    return null;
  }

  function B() {
    useLinking(ref, options, () => {});
    return null;
  }

  element = render(
    <>
      <A />
      <B />
    </>
  );

  expect(errorSpy).toHaveBeenCalledTimes(2);
  expect(errorSpy.mock.calls[1]![0]).toMatch(
    'Looks like you have configured linking in multiple places.'
  );

  element?.unmount();

  function Sample2() {
    useLinking(ref, options, () => {});
    return null;
  }

  const wrapper2 = <Sample2 />;

  render(wrapper2).unmount();

  element = render(wrapper2);

  expect(errorSpy).toHaveBeenCalledTimes(2);

  element?.unmount();
});
