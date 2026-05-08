import { VoxelMapViewer } from '@/components/VoxelMapViewer';

export const metadata = {
  title: 'Voxel Cafe',
};

export default function CafePage() {
  return <VoxelMapViewer terrain="cafe" />;
}
