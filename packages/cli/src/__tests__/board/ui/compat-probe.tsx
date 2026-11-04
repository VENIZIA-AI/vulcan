import { useEffect, useId, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

const Field = (opts: { name: string }) => {
  const id = useId();
  const [value, setValue] = useState('');

  return (
    <label>
      <span data-id={id} data-name={opts.name} />
      <input
        data-field={opts.name}
        value={value}
        onChange={(event) => setValue(event.currentTarget.value)}
      />
      <output data-mirror={opts.name}>{value}</output>
    </label>
  );
};

const List = () => {
  const [order, setOrder] = useState(['a', 'b', 'c']);
  const holder = useRef<HTMLUListElement | null>(null);
  const [seen, setSeen] = useState('');

  useEffect(() => {
    setSeen(holder.current ? holder.current.tagName : 'no ref');
  }, []);

  return (
    <div>
      <button type="button" data-action="reverse" onClick={() => setOrder([...order].reverse())} />
      <ul ref={holder}>
        {order.map((item) => (
          <li key={item} data-item={item} ref={(node) => node?.setAttribute('data-ref', 'set')} />
        ))}
      </ul>
      <output data-seen="">{seen}</output>
    </div>
  );
};

const App = () => (
  <div>
    <Field name="one" />
    <Field name="two" />
    <List />
  </div>
);

const root = document.getElementById('root');

if (root) {
  createRoot(root).render(<App />);
}
