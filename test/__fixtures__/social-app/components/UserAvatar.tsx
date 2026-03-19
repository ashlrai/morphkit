import type { User } from '@/types/social';

interface UserAvatarProps {
  user: Pick<User, 'avatarUrl' | 'displayName'>;
  size?: 'sm' | 'md' | 'lg';
}

const sizeMap = { sm: 'h-8 w-8', md: 'h-10 w-10', lg: 'h-20 w-20' };

export function UserAvatar({ user, size = 'md' }: UserAvatarProps) {
  return (
    <img
      src={user.avatarUrl}
      alt={user.displayName}
      className={`${sizeMap[size]} rounded-full object-cover`}
    />
  );
}
