import { VoxelMapViewer } from '@/components/VoxelMapViewer';

export const metadata = {
  title: 'Voxel City',
};

export default function CityPage() {
  return <VoxelMapViewer terrain="city" />;
}
