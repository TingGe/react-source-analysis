/**
 * Copyright (c) 2013-present, Facebook, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/**
 * By TingGe<505253293@163.com>
 * @file 一个 React 的渲染器，可以用来将 React 组件渲染成纯 JavaScript 对象。
 */

import type {Fiber} from 'react-reconciler/src/ReactFiber';
import type {FiberRoot} from 'react-reconciler/src/ReactFiberRoot';
import type {Instance, TextInstance} from './ReactTestHostConfig';

import * as TestRenderer from 'react-reconciler/inline.test';
import {batchedUpdates} from 'events/ReactGenericBatching';
import {findCurrentFiberUsingSlowPath} from 'react-reconciler/reflection';
import {
  Fragment,
  FunctionalComponent,
  ClassComponent,
  HostComponent,
  HostPortal,
  HostText,
  HostRoot,
  ContextConsumer,
  ContextProvider,
  Mode,
  ForwardRef,
  Profiler,
} from 'shared/ReactTypeOfWork';
import invariant from 'fbjs/lib/invariant';

import * as ReactTestHostConfig from './ReactTestHostConfig';
import * as TestRendererScheduling from './ReactTestRendererScheduling';

type TestRendererOptions = {
  createNodeMock: (element: React$Element<any>) => any,
  unstable_isAsync: boolean,
};

type ReactTestRendererJSON = {|
  type: string,
  props: {[propName: string]: any},
  children: null | Array<ReactTestRendererNode>,
  $$typeof?: Symbol, // Optional because we add it with defineProperty().
|};
type ReactTestRendererNode = ReactTestRendererJSON | string;

type FindOptions = $Shape<{
  // performs a "greedy" search: if a matching node is found, will continue
  // to search within the matching node's children. (default: true)
  deep: boolean,
}>;

export type Predicate = (node: ReactTestInstance) => ?boolean;

const defaultTestOptions = {
  /**
   * By TingGe<505253293@163.com>
   * 选项配置：TestRenderer.create(element, options) 中的选项配置之一。
   * 特点：createNodeMock 接受当前元素作为参数，并且返回一个模拟的 ref 对象。
   * 适用场景：测试一个依赖于 refs 的组件时，它十分有用。
   */
  createNodeMock: function() {
    return null;
  },
};

function toJSON(inst: Instance | TextInstance): ReactTestRendererNode {
  switch (inst.tag) {
    case 'TEXT':
      return inst.text;
    case 'INSTANCE':
      /* eslint-disable no-unused-vars */
      // We don't include the `children` prop in JSON.
      // Instead, we will include the actual rendered children.
      const {children, ...props} = inst.props;
      /* eslint-enable */
      let renderedChildren = null;
      if (inst.children && inst.children.length) {
        renderedChildren = inst.children.map(toJSON);
      }
      const json: ReactTestRendererJSON = {
        type: inst.type,
        props: props,
        children: renderedChildren,
      };
      Object.defineProperty(json, '$$typeof', {
        value: Symbol.for('react.test.json'),
      });
      return json;
    default:
      throw new Error(`Unexpected node type in toJSON: ${inst.tag}`);
  }
}

function childrenToTree(node) {
  if (!node) {
    return null;
  }
  const children = nodeAndSiblingsArray(node);
  if (children.length === 0) {
    return null;
  } else if (children.length === 1) {
    return toTree(children[0]);
  }
  return flatten(children.map(toTree));
}

function nodeAndSiblingsArray(nodeWithSibling) {
  const array = [];
  let node = nodeWithSibling;
  while (node != null) {
    array.push(node);
    node = node.sibling;
  }
  return array;
}

function flatten(arr) {
  const result = [];
  const stack = [{i: 0, array: arr}];
  while (stack.length) {
    const n = stack.pop();
    while (n.i < n.array.length) {
      const el = n.array[n.i];
      n.i += 1;
      if (Array.isArray(el)) {
        stack.push(n);
        stack.push({i: 0, array: el});
        break;
      }
      result.push(el);
    }
  }
  return result;
}

function toTree(node: ?Fiber) {
  if (node == null) {
    return null;
  }
  switch (node.tag) {
    case HostRoot:
      return childrenToTree(node.child);
    case HostPortal:
      return childrenToTree(node.child);
    case ClassComponent:
      return {
        nodeType: 'component',
        type: node.type,
        props: {...node.memoizedProps},
        instance: node.stateNode,
        rendered: childrenToTree(node.child),
      };
    case FunctionalComponent:
      return {
        nodeType: 'component',
        type: node.type,
        props: {...node.memoizedProps},
        instance: null,
        rendered: childrenToTree(node.child),
      };
    case HostComponent: {
      return {
        nodeType: 'host',
        type: node.type,
        props: {...node.memoizedProps},
        instance: null, // TODO: use createNodeMock here somehow?
        rendered: flatten(nodeAndSiblingsArray(node.child).map(toTree)),
      };
    }
    case HostText:
      return node.stateNode.text;
    case Fragment:
    case ContextProvider:
    case ContextConsumer:
    case Mode:
    case Profiler:
    case ForwardRef:
      return childrenToTree(node.child);
    default:
      invariant(
        false,
        'toTree() does not yet know how to handle nodes with tag=%s',
        node.tag,
      );
  }
}

const fiberToWrapper = new WeakMap();
function wrapFiber(fiber: Fiber): ReactTestInstance {
  let wrapper = fiberToWrapper.get(fiber);
  if (wrapper === undefined && fiber.alternate !== null) {
    wrapper = fiberToWrapper.get(fiber.alternate);
  }
  if (wrapper === undefined) {
    wrapper = new ReactTestInstance(fiber);
    fiberToWrapper.set(fiber, wrapper);
  }
  return wrapper;
}

const validWrapperTypes = new Set([
  FunctionalComponent,
  ClassComponent,
  HostComponent,
  ForwardRef,
]);

/**
  * By TingGe<505253293@163.com>
  * “测试实例（test instance）”对象
  * 
  * 示例：
  * const testRenderer = TestRenderer.create(<MyComponent />);
  * const testInstance = testRenderer.root;
  */
class ReactTestInstance {
  _fiber: Fiber;

  _currentFiber(): Fiber {
    // Throws if this component has been unmounted.
    const fiber = findCurrentFiberUsingSlowPath(this._fiber);
    invariant(
      fiber !== null,
      "Can't read from currently-mounting component. This error is likely " +
        'caused by a bug in React. Please file an issue.',
    );
    return fiber;
  }

  constructor(fiber: Fiber) {
    invariant(
      validWrapperTypes.has(fiber.tag),
      'Unexpected object passed to ReactTestInstance constructor (tag: %s). ' +
        'This is probably a bug in React.',
      fiber.tag,
    );
    this._fiber = fiber;
  }

  /**
   * By TingGe<505253293@163.com>
   * testInstance.instance
   * “测试实例（test instance）”对象属性：该测试实例（testInstances）相对应的组件的实例。
   * 特点：只能用于 类组件（class components），因为函数组件（functional components）没有实例。它匹* 配给定的组件内部的 this 的值。
   */
  get instance() {
    if (this._fiber.tag === HostComponent) {
      return ReactTestHostConfig.getPublicInstance(this._fiber.stateNode);
    } else {
      return this._fiber.stateNode;
    }
  }

  /**
   * By TingGe<505253293@163.com>
   * testInstance.type
   * “测试实例（test instance）”对象属性：该测试实例（testInstance）相对应的组件的类型（type），例如，* 一个 <Button /> 组件有一个 Button 类型（type）。
   */
  get type() {
    return this._fiber.type;
  }

  /**
   * By TingGe<505253293@163.com>
   * testInstance.props
   * “测试实例（test instance）”对象属性：该测试实例（testInstance）相对应的组件的属性（props），例
   * 如，一个 <Button size="small" /> 组件的属性（props）为 {size: 'small'}。
   */
  get props(): Object {
    return this._currentFiber().memoizedProps;
  }

  /**
   * By TingGe<505253293@163.com>
   * testInstance.parent
   * “测试实例（test instance）”对象属性：该测试实例的父测试实例。
   */
  get parent(): ?ReactTestInstance {
    let parent = this._fiber.return;
    while (parent !== null) {
      if (validWrapperTypes.has(parent.tag)) {
        return wrapFiber(parent);
      }
      parent = parent.return;
    }
    return null;
  }
  
  /**
   * By TingGe<505253293@163.com>
   * testInstance.children
   * “测试实例（test instance）”对象属性：该测试实例的子测试实例。
   */
  get children(): Array<ReactTestInstance | string> {
    const children = [];
    const startingNode = this._currentFiber();
    let node: Fiber = startingNode;
    if (node.child === null) {
      return children;
    }
    node.child.return = node;
    node = node.child;
    outer: while (true) {
      let descend = false;
      if (validWrapperTypes.has(node.tag)) {
        children.push(wrapFiber(node));
      } else if (node.tag === HostText) {
        children.push('' + node.memoizedProps);
      } else {
        descend = true;
      }
      if (descend && node.child !== null) {
        node.child.return = node;
        node = node.child;
        continue;
      }
      while (node.sibling === null) {
        if (node.return === startingNode) {
          break outer;
        }
        node = (node.return: any);
      }
      (node.sibling: any).return = node.return;
      node = (node.sibling: any);
    }
    return children;
  }

  /**
   * By TingGe<505253293@163.com>
   * testInstance.find()
   * “测试实例（test instance）”对象方法：
   * 找到一个 test(testInstance) 返回 true 的后代 测试实例。如果 test(testInstance) 没有正好只对一* 个 测试实例 返回 true，将会报错。
   */
  // Custom search functions
  find(predicate: Predicate): ReactTestInstance {
    return expectOne(
      this.findAll(predicate, {deep: false}),
      `matching custom predicate: ${predicate.toString()}`,
    );
  }

  /**
   * By TingGe<505253293@163.com>
   * testInstance.findByType()
   * “测试实例（test instance）”对象方法：
   * 找到一个匹配指定 类型（type）的 后代 测试实例（testInstances），如果不是正好只有一个测试实例匹配指* 定的 类型（type），将会报错。
   */
  findByType(type: any): ReactTestInstance {
    return expectOne(
      this.findAllByType(type, {deep: false}),
      `with node type: "${type.displayName || type.name}"`,
    );
  }

  /**
   * By TingGe<505253293@163.com>
   * testInstance.findByProps()
   * “测试实例（test instance）”对象方法：
   * 找到匹配指定 属性（props）的 后代 测试实例（testInstances），如果不是正好只有一个测试实例匹配指定* 的 类型（type），将会报错。
   */
  findByProps(props: Object): ReactTestInstance {
    return expectOne(
      this.findAllByProps(props, {deep: false}),
      `with props: ${JSON.stringify(props)}`,
    );
  }
  /**
   * By TingGe<505253293@163.com>
   * testInstance.findAll()
   * “测试实例（test instance）”对象方法：
   * 找到所有 test(testInstance) 等于 true 的后代 测试实例（testInstances）。
   */
  findAll(
    predicate: Predicate,
    options: ?FindOptions = null,
  ): Array<ReactTestInstance> {
    return findAll(this, predicate, options);
  }
  /**
   * By TingGe<505253293@163.com>
   * testInstance.findAllByType()
   * “测试实例（test instance）”对象方法：
   * 找到所有匹配指定 类型（type）的 后代 测试实例（testInstances）。
   */
  findAllByType(
    type: any,
    options: ?FindOptions = null,
  ): Array<ReactTestInstance> {
    return findAll(this, node => node.type === type, options);
  }
 /**
   * By TingGe<505253293@163.com>
   * testInstance.findAllByProps()
   * “测试实例（test instance）”对象方法：
   * 找到所有匹配指定 属性（props）的 后代 测试实例（testInstances）。
   */
  findAllByProps(
    props: Object,
    options: ?FindOptions = null,
  ): Array<ReactTestInstance> {
    return findAll(
      this,
      node => node.props && propsMatch(node.props, props),
      options,
    );
  }
}

function findAll(
  root: ReactTestInstance,
  predicate: Predicate,
  options: ?FindOptions,
): Array<ReactTestInstance> {
  const deep = options ? options.deep : true;
  const results = [];

  if (predicate(root)) {
    results.push(root);
    if (!deep) {
      return results;
    }
  }

  root.children.forEach(child => {
    if (typeof child === 'string') {
      return;
    }
    results.push(...findAll(child, predicate, options));
  });

  return results;
}

function expectOne(
  all: Array<ReactTestInstance>,
  message: string,
): ReactTestInstance {
  if (all.length === 1) {
    return all[0];
  }

  const prefix =
    all.length === 0
      ? 'No instances found '
      : `Expected 1 but found ${all.length} instances `;

  throw new Error(prefix + message);
}

function propsMatch(props: Object, filter: Object): boolean {
  for (const key in filter) {
    if (props[key] !== filter[key]) {
      return false;
    }
  }
  return true;
}

const ReactTestRendererFiber = {
  /**
   * By TingGe<505253293@163.com>
   * TestRenderer.create()
   * 原型对象方法：通过传来的 React 元素创建一个 TestRenderer 实例
   * @param element React元素
   * @param options: 可选属性 createNodeMock 方法、unstable_isAsync。
   */
  create(element: React$Element<any>, options: TestRendererOptions) {
    let createNodeMock = defaultTestOptions.createNodeMock;
    let isAsync = false;
    if (typeof options === 'object' && options !== null) {
      if (typeof options.createNodeMock === 'function') {
        createNodeMock = options.createNodeMock;
      }
      if (options.unstable_isAsync === true) {
        isAsync = true;
      }
    }
    let container = {
      children: [],
      createNodeMock,
      tag: 'CONTAINER',
    };
    let root: FiberRoot | null = TestRenderer.createContainer(
      container,
      isAsync,
      false,
    );
    invariant(root != null, 'something went wrong');
    TestRenderer.updateContainer(element, root, null, null);

    const entry = {
     /**
      * By TingGe<505253293@163.com>
      * testRenderer.root
      * 实例属性：返回根元素“测试实例（test instance）”对象，对于断言树中的特殊节点十分有用。
      * 适用场景：可利用它查找其他更深层的“测试实例（test instance）”。
      */
      root: undefined, // makes flow happy
      // we define a 'getter' for 'root' below using 'Object.defineProperty'
      /**
      * By TingGe<505253293@163.com>
      * testRenderer.toJSON()
      * 实例方法：返回一个表示渲染后的“树”的对象。
      * 特点：该树仅包含特定平台的节点，像<div> 或 <View> 和他们的属性（props），但不包含任何用户编写的组件。
      * 适用场景：对于快照测试非常方便。
      */
      toJSON(): Array<ReactTestRendererNode> | ReactTestRendererNode | null {
        if (root == null || root.current == null || container == null) {
          return null;
        }
        if (container.children.length === 0) {
          return null;
        }
        if (container.children.length === 1) {
          return toJSON(container.children[0]);
        }
        return container.children.map(toJSON);
      },
      /**
      * By TingGe<505253293@163.com>
      * testRenderer.toTree()
      * 实例方法：返回一个表示渲染后的“树”的对象。
      * 特点：它表示的内容比 toJSON() 提供的内容要更加详细，且包含用户编写的组件。
      * 适用场景：除非在测试渲染器（test rendererer）之上编写自己的断言库，否则可能不需要这个方法。
      */
      toTree() {
        if (root == null || root.current == null) {
          return null;
        }
        return toTree(root.current);
      },

      /**
      * By TingGe<505253293@163.com>
      * testRenderer.update()
      * 实例方法：模拟根元素的一次React更新。如果新的元素和之前的元素有相同的 type 和 key，该树将会被更新；否则，它将重挂载一个新树。
      */
      update(newElement: React$Element<any>) {
        if (root == null || root.current == null) {
          return;
        }
        TestRenderer.updateContainer(newElement, root, null, null);
      },
      /**
      * By TingGe<505253293@163.com>
      * testRenderer.unmount()
      * 实例方法：卸载内存中的树，触发相应的生命周期事件。
      */
      unmount() {
        if (root == null || root.current == null) {
          return;
        }
        TestRenderer.updateContainer(null, root, null, null);
        container = null;
        root = null;
      },
      /**
      * By TingGe<505253293@163.com>
      * testRenderer.getInstance()
      * 实例方法：如果可用的话，返回与根元素相对应的实例。如果根元素是函数组件（functional component），该方法无效，因为函数组件没有实例。
      */
      getInstance() {
        if (root == null || root.current == null) {
          return null;
        }
        return TestRenderer.getPublicRootInstance(root);
      },
      unstable_flushAll: TestRendererScheduling.flushAll,
      unstable_flushSync(fn: Function) {
        return TestRendererScheduling.withCleanYields(() => {
          TestRenderer.flushSync(fn);
        });
      },
      unstable_flushThrough: TestRendererScheduling.flushThrough,
      unstable_yield: TestRendererScheduling.yieldValue,
    };

    Object.defineProperty(
      entry,
      'root',
      ({
        configurable: true,
        enumerable: true,
        get: function() {
          if (root === null || root.current.child === null) {
            throw new Error("Can't access .root on unmounted test renderer");
          }
          return wrapFiber(root.current.child);
        },
      }: Object),
    );

    return entry;
  },

  /* eslint-disable camelcase */
  unstable_batchedUpdates: batchedUpdates,
  /* eslint-enable camelcase */

  unstable_setNowImplementation: TestRendererScheduling.setNowImplementation,
};

export default ReactTestRendererFiber;
