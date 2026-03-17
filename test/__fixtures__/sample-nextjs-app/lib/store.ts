import { create } from 'zustand';
import type { Product, CartItem, Cart } from '@/types/product';

interface CartStore extends Cart {
  addItem: (product: Product) => void;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
}

export const useCartStore = create<CartStore>((set, get) => ({
  items: [],
  total: 0,

  addItem: (product: Product) => {
    set((state) => {
      const existing = state.items.find((i) => i.product.id === product.id);
      if (existing) {
        return {
          items: state.items.map((i) =>
            i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i
          ),
          total: state.total + product.price,
        };
      }
      return {
        items: [...state.items, { product, quantity: 1 }],
        total: state.total + product.price,
      };
    });
  },

  removeItem: (productId: string) => {
    set((state) => {
      const item = state.items.find((i) => i.product.id === productId);
      return {
        items: state.items.filter((i) => i.product.id !== productId),
        total: state.total - (item ? item.product.price * item.quantity : 0),
      };
    });
  },

  updateQuantity: (productId: string, quantity: number) => {
    set((state) => {
      const item = state.items.find((i) => i.product.id === productId);
      if (!item) return state;
      const diff = (quantity - item.quantity) * item.product.price;
      return {
        items: state.items.map((i) =>
          i.product.id === productId ? { ...i, quantity } : i
        ),
        total: state.total + diff,
      };
    });
  },

  clearCart: () => set({ items: [], total: 0 }),
}));
