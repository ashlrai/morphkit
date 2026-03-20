export default function handler(req: any, res: any) {
  res.status(200).json([
    { id: '1', name: 'Widget', price: 29.99, category: 'gadgets' },
    { id: '2', name: 'Gizmo', price: 49.99, category: 'gadgets' },
  ]);
}
