# Effect replacement patterns

Before/after code for each rung of the removal ladder in [`SKILL.md`](SKILL.md), condensed from React's [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect). Each entry names the smell to match, the replacement, and the behavior to check before applying it.

## Derived value

Smell: an Effect whose only job is `setX(f(props, state))`.

```jsx
// Before: one render with a stale fullName, then a second render
const [fullName, setFullName] = useState('');
useEffect(() => {
  setFullName(firstName + ' ' + lastName);
}, [firstName, lastName]);

// After
const fullName = firstName + ' ' + lastName;
```

Several Effects that each derive from the previous one's state collapse into plain expressions the same way.

## Expensive calculation

Smell: derived state kept in an Effect "for performance".

```jsx
const visibleTodos = useMemo(
  () => getFilteredTodos(todos, filter),
  [todos, filter],
);
```

Check first:

- Is it slow? Wrap the calculation in `console.time` / `console.timeEnd`, run the interaction, and memoize only when it takes about 1 ms or more. Measure a production build, with CPU throttling, since Strict Mode renders twice in development.
- Does the project use React Compiler? It memoizes automatically, so a manual `useMemo` is usually redundant there.
- `useMemo` runs during render: the wrapped function must be pure. It speeds up updates, never the first render.

## Interaction logic

Smell: state set in a handler only so an Effect can react to it (`setJsonToSubmit`, `product.isInCart`), or the same side effect needed by several handlers.

```jsx
// Before: the notification also fires on page load when the cart is persisted
useEffect(() => {
  if (product.isInCart) showNotification(`Added ${product.name}!`);
}, [product]);

// After: a shared function called from every handler that buys
function buyProduct() {
  addToCart(product);
  showNotification(`Added ${product.name}!`);
}
function handleBuyClick() { buyProduct(); }
function handleCheckoutClick() { buyProduct(); navigateTo('/checkout'); }
```

A form submit follows the same shape: `post('/api/register', data)` goes in `handleSubmit`, not in an Effect that watches a `jsonToSubmit` state.

## Chain of state updates

Smell: Effects that set state only to trigger the next Effect (`card` → `goldCardCount` → `round` → `isGameOver`). Each link adds a render pass, and the chain fires again whenever any link is set directly, such as when replaying history.

```jsx
const isGameOver = round > 5; // derive what you can

function handlePlaceCard(nextCard) {
  if (isGameOver) throw Error('Game already ended.');
  setCard(nextCard);
  if (nextCard.gold) {
    if (goldCardCount < 3) {
      setGoldCardCount(goldCardCount + 1);
    } else {
      setGoldCardCount(0);
      setRound(round + 1);
      if (round === 5) alert('Good game!');
    }
  }
}
```

State is a snapshot inside a handler: after `setRound(round + 1)`, `round` still holds the old value. Compute `const nextRound = round + 1` when later logic needs the new one.

A chain stays an Effect chain when each link synchronizes with an external system, such as cascading dropdowns where each one loads its options from the network.

## Notify the parent

Smell: `useEffect(() => onChange(value), [value, onChange])`. The parent updates one render pass late.

```jsx
function updateToggle(nextIsOn) {
  setIsOn(nextIsOn);
  onChange(nextIsOn); // batched with the child's update: one render
}
```

When the parent already tracks the value, make the child controlled instead: drop the local state, read `isOn` from props, and call `onChange` from the handlers.

## Reset all state with a key

Smell: an Effect that clears state when an identity prop changes (`setComment('')` on `userId`).

```jsx
export default function ProfilePage({ userId }) {
  return <Profile userId={userId} key={userId} />;
}

function Profile({ userId }) {
  const [comment, setComment] = useState(''); // resets with the key
  // ...
}
```

The `key` also resets every nested child's state. Keep it inside the exported wrapper so callers pass `userId` as a normal prop.

## Store the ID, derive the object

Smell: an Effect that clears or fixes up a stored object when the list it came from changes.

```jsx
const [selectedId, setSelectedId] = useState(null);
const selection = items.find((item) => item.id === selectedId) ?? null;
```

This changes behavior: the selection now survives list changes when the item is still present, where the Effect always cleared it. Report the difference rather than treating it as a pure refactor.

## Data the parent also needs

Smell: a child fetches data and pushes it up with `useEffect(() => onFetched(data), [data])`. Data that flows upward from Effects is hard to trace.

```jsx
function Parent() {
  const data = useSomeAPI();
  return <Child data={data} />;
}
```

## External store

Smell: an Effect that subscribes to a browser API or third-party store and copies its value into state.

```jsx
function subscribe(callback) {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

export function useOnlineStatus() {
  return useSyncExternalStore(
    subscribe, // define it outside the component so React keeps the subscription
    () => navigator.onLine, // client value
    () => true, // server value
  );
}
```

## App initialization

Smell: `useEffect(() => { checkAuthToken(); }, [])` in the root component. It runs twice in development, which breaks logic that cannot run twice, such as token invalidation.

```jsx
// Once per app load, before render, in the entry point or root module
if (typeof window !== 'undefined') {
  checkAuthToken();
  loadDataFromLocalStorage();
}
```

When the work must stay in the component, guard it with a module-level flag:

```jsx
let didInit = false;

function App() {
  useEffect(() => {
    if (didInit) return;
    didInit = true;
    checkAuthToken();
  }, []);
}
```

Module-level code runs on import, even if the component never renders, so keep it to the root module or the entry point.

## Data synchronization

Fetching because the current `query` and `page` are on screen is legitimate synchronization, even when typing changed the query: the same values also arrive from the URL and from Back/Forward navigation. Keep it in an Effect, or better in the framework's loader or a cache library, and ignore stale responses:

```jsx
function useData(url) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let ignore = false;
    fetch(url)
      .then((response) => response.json())
      .then((json) => {
        if (!ignore) setData(json);
      });
    return () => {
      ignore = true;
    };
  }, [url]);
  return data;
}
```

A raw Effect still lacks caching, server rendering, and waterfall avoidance. Extracting it into a Hook like `useData` (adding loading and error state) keeps components declarative and makes a later move to a framework or cache library a one-place change.

## Adjust part of the state during render

Last resort, when only some state must follow a prop and none of the patterns above fits:

```jsx
const [prevItems, setPrevItems] = useState(items);
if (items !== prevItems) {
  setPrevItems(items);
  setSelection(null);
}
```

Rules: set only this component's own state, always behind an identity guard that stops the loop, and keep every other side effect (DOM, timers, requests) in handlers or Effects. React discards the JSX and re-renders before the children see the stale value.

## Effects that stay

Code that runs because the component is displayed belongs in an Effect:

```jsx
useEffect(() => {
  post('/analytics/event', { eventName: 'visit_form' });
}, []);
```

It fires twice in development under Strict Mode and once per display in production. Leave it as is; filter development traffic out of analytics if the double event matters.
