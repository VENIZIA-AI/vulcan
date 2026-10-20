/** The values of a const class's static fields: `TConstValue<typeof Colors>` is `'red' | 'blue'`. */
export type TConstValue<TClass> = Extract<TClass[keyof TClass], string | number> & {};
